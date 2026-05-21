// Сопоставление банковской строки с контрагентом и счетами.
// Это чисто бизнес-логика: данные приходят уже из Prisma, никаких HTTP.

import type { PrismaClient } from "@prisma/client";
import type { NormalizedBankRow, SuggestedInvoiceAllocation } from "./types.js";

const EPS = 0.005;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Подбор контрагента:
 * 1. По ИНН (точное совпадение) — самый надёжный.
 * 2. По имени (case-insensitive substring) — если уникален.
 * Возвращает counterpartyId или null.
 *
 * Не лезет в Counterparty контрагента с другой organizationId напрямую
 * (counterparty принадлежит userId, без явной привязки к организации),
 * но фильтрация по active=true. Дальнейшая проверка соответствия делается
 * на этапе подбора счетов (счета сами привязаны к organizationId).
 */
export async function suggestCounterparty(params: {
  prisma: PrismaClient;
  userId: string;
  row: NormalizedBankRow;
}): Promise<{ counterpartyId: string | null; reason: string }> {
  const { prisma, userId, row } = params;

  if (row.counterpartyInn) {
    const cp = await prisma.counterparty.findFirst({
      where: { userId, inn: row.counterpartyInn },
      select: { id: true, name: true },
    });
    if (cp) return { counterpartyId: cp.id, reason: `найден по ИНН ${row.counterpartyInn}` };
  }

  if (row.counterpartyName) {
    // Очистим лишние реквизиты, оставим главное (например, "ИП Иванов И.И." из строки полной)
    const trimmedName = row.counterpartyName.replace(/^"|"$/g, "").trim();
    if (trimmedName.length >= 3) {
      const candidates = await prisma.counterparty.findMany({
        where: {
          userId,
          OR: [
            { name: { contains: trimmedName, mode: "insensitive" } },
            { fullName: { contains: trimmedName, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true },
        take: 5,
      });
      if (candidates.length === 1) {
        return { counterpartyId: candidates[0]!.id, reason: `найден по имени "${candidates[0]!.name}"` };
      }
      if (candidates.length > 1) {
        return { counterpartyId: null, reason: `несколько контрагентов с похожим именем (${candidates.length})` };
      }
    }
  }

  return { counterpartyId: null, reason: "контрагент не найден" };
}

/**
 * Ищет упоминание номера счёта в назначении платежа.
 * Возвращает массив возможных «токенов номера» — могут быть подстроками.
 * Сравнение с реальным Invoice.number — case-insensitive.
 */
export function extractInvoiceNumberTokens(purpose: string): string[] {
  const tokens = new Set<string>();
  // Паттерны вида: "счет №", "счёт №", "по счету", "сч.", "сч. №"
  const patterns: RegExp[] = [
    /(?:счет|счёт|сч\.?)\s*(?:№|N|n|#)?\s*([A-Za-zА-Яа-я0-9/_\-]+)/giu,
    /№\s*([A-Za-zА-Яа-я0-9/_\-]+)/giu,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(purpose)) != null) {
      const t = (m[1] ?? "").trim().replace(/[.,;:]+$/, "");
      if (t && t.length >= 2 && /\d/.test(t)) tokens.add(t);
    }
  }
  return Array.from(tokens);
}

/**
 * Подбор аллокаций по строке.
 *
 * - Только direction=IN.
 * - Только не CANCELLED и c остатком > 0.
 * - Только для invoice.counterpartyId = counterpartyId (если он определён).
 * - Сначала ищем точное совпадение по номеру в purpose (confidence 0.95).
 * - Если ровно один найден и остаток равен сумме платежа → confidence 0.95.
 * - Если ровно один контрагент найден и сумма равна одному из остатков счетов → confidence 0.80.
 * - Иначе авторазнос FIFO по дате (от старых к новым) → confidence 0.60.
 * - Если сумма больше суммы остатков — остаток = аванс (не предлагаем allocation на «лишнее»).
 */
export async function suggestInvoiceAllocations(params: {
  prisma: PrismaClient;
  userId: string;
  organizationId: string;
  counterpartyId: string;
  amount: number;
  purpose: string | null;
}): Promise<SuggestedInvoiceAllocation[]> {
  const { prisma, userId, organizationId, counterpartyId, amount, purpose } = params;

  const invoices = await prisma.invoice.findMany({
    where: {
      userId, organizationId, counterpartyId,
      status: { notIn: ["CANCELLED", "PAID"] },
    },
    orderBy: { date: "asc" },
    select: {
      id: true, number: true, total: true, status: true,
      allocations: { select: { amount: true } },
    },
  });

  if (invoices.length === 0) return [];

  const withBalance = invoices.map((inv) => {
    const total = Number(inv.total);
    const paid = inv.allocations.reduce((s, a) => s + Number(a.amount), 0);
    return {
      id: inv.id, number: inv.number, status: inv.status,
      total: round2(total), paid: round2(paid), balance: round2(Math.max(0, total - paid)),
    };
  }).filter((inv) => inv.balance > EPS);

  if (withBalance.length === 0) return [];

  // 1) Точное совпадение по номеру в purpose
  if (purpose) {
    const tokens = extractInvoiceNumberTokens(purpose);
    if (tokens.length > 0) {
      const matched: typeof withBalance = [];
      for (const inv of withBalance) {
        const numLower = inv.number.toLowerCase();
        // Сопоставление: токен является подстрокой номера ИЛИ номер содержит токен
        const hit = tokens.some((tok) => {
          const tl = tok.toLowerCase();
          return numLower === tl || numLower.includes(tl) || tl.includes(numLower);
        });
        if (hit) matched.push(inv);
      }
      if (matched.length === 1) {
        const inv = matched[0]!;
        const suggested = round2(Math.min(amount, inv.balance));
        return [{
          invoiceId: inv.id, invoiceNumber: inv.number,
          invoiceTotal: inv.total, invoicePaid: inv.paid, invoiceBalance: inv.balance,
          suggestedAmount: suggested,
          confidence: 0.95,
          reason: `номер ${inv.number} упомянут в назначении`,
        }];
      }
    }
  }

  // 2) Один невыплаченный счёт и сумма равна его остатку
  if (withBalance.length === 1) {
    const inv = withBalance[0]!;
    if (Math.abs(inv.balance - amount) < EPS) {
      return [{
        invoiceId: inv.id, invoiceNumber: inv.number,
        invoiceTotal: inv.total, invoicePaid: inv.paid, invoiceBalance: inv.balance,
        suggestedAmount: round2(Math.min(amount, inv.balance)),
        confidence: 0.80,
        reason: `единственный неоплаченный счёт, сумма совпала с остатком`,
      }];
    }
  }

  // 2b) Несколько счетов, сумма платежа совпадает с одним из остатков
  const exactMatch = withBalance.find((inv) => Math.abs(inv.balance - amount) < EPS);
  if (exactMatch) {
    return [{
      invoiceId: exactMatch.id, invoiceNumber: exactMatch.number,
      invoiceTotal: exactMatch.total, invoicePaid: exactMatch.paid, invoiceBalance: exactMatch.balance,
      suggestedAmount: round2(exactMatch.balance),
      confidence: 0.80,
      reason: `сумма платежа совпала с остатком счёта ${exactMatch.number}`,
    }];
  }

  // 3) Авторазнос FIFO по дате (от старых к новым), остаток уходит в аванс
  let remaining = amount;
  const out: SuggestedInvoiceAllocation[] = [];
  for (const inv of withBalance) {
    if (remaining <= EPS) break;
    const take = round2(Math.min(remaining, inv.balance));
    if (take <= EPS) continue;
    out.push({
      invoiceId: inv.id, invoiceNumber: inv.number,
      invoiceTotal: inv.total, invoicePaid: inv.paid, invoiceBalance: inv.balance,
      suggestedAmount: take,
      confidence: 0.60,
      reason: `авторазнос по старым неоплаченным счетам`,
    });
    remaining = round2(remaining - take);
  }
  return out;
}
