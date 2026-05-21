// Sprint 6A + 6B: безопасный executor для AI action.
// Перед каждым действием — проверка owner / cross-organization.
// Бизнес-логика повторно использует существующие helpers (numbering, document-items).

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { nextDocumentNumber } from "../numbering.js";
import { prepareItems, itemCreateData } from "../document-items.js";
import { createPaymentInTx, round2 } from "../payments-service.js";
import {
  vatRateToNumber,
  type Action,
  type AppliedAction,
  type FailedAction,
  type TargetType,
  type CreateCounterpartyPayload,
  type CreateInvoicePayload,
  type CreateActFromInvoicePayload,
  type CreateContractPayload,
  type AnalyzeDebtPayload,
  type CreatePaymentPayload,
  type SuggestPaymentAllocationsPayload,
  type DebtAnalysisResult,
  type DebtAnalysisCounterparty,
  type PaymentSuggestionResult,
  type PaymentSuggestionAllocation,
} from "./schemas.js";

/** Контракт ошибки executor — содержит сообщение и кодируется как FailedAction. */
class ExecutorError extends Error {}

/* ---------- ownership helpers ---------- */

async function ensureOrganizationOwner(userId: string, organizationId: string): Promise<void> {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, userId },
    select: { id: true, inn: true },
  });
  if (!org) throw new ExecutorError("Организация не найдена или принадлежит другому пользователю");
}

async function ensureCounterpartyOwner(userId: string, counterpartyId: string): Promise<{ id: string; inn: string }> {
  const cp = await prisma.counterparty.findFirst({
    where: { id: counterpartyId, userId },
    select: { id: true, inn: true },
  });
  if (!cp) throw new ExecutorError("Контрагент не найден или принадлежит другому пользователю");
  return cp;
}

/* ---------- executor result type ---------- */

export interface ExecutorOutcome {
  targetType: TargetType;
  targetId: string | null;
  result?: DebtAnalysisResult | PaymentSuggestionResult;
}

/* ---------- create_counterparty ---------- */

async function executeCreateCounterparty(
  userId: string,
  payload: CreateCounterpartyPayload,
): Promise<ExecutorOutcome> {
  await ensureOrganizationOwner(userId, payload.organizationId);

  // Проверка: не пытаемся создать контрагента с теми же реквизитами, что у организации пользователя
  const ownOrg = await prisma.organization.findFirst({
    where: { userId, inn: payload.inn, ...(payload.kpp ? { kpp: payload.kpp } : {}) },
    select: { id: true },
  });
  if (ownOrg) {
    throw new ExecutorError("Нельзя создать контрагента, совпадающего с собственной организацией");
  }

  // Проверка дубля
  const existing = await prisma.counterparty.findFirst({ where: { userId, inn: payload.inn } });
  if (existing) {
    throw new ExecutorError(`Контрагент с ИНН ${payload.inn} уже существует (id ${existing.id})`);
  }

  const cp = await prisma.counterparty.create({
    data: {
      userId,
      type: payload.inn.length === 12 ? "IP" : "OOO",
      inn: payload.inn,
      kpp: payload.kpp ?? null,
      name: payload.name,
      fullName: payload.name,
      legalAddress: payload.legalAddress ?? null,
      phone: payload.phone ?? null,
      email: payload.email ?? null,
    },
  });
  return { targetType: "counterparty", targetId: cp.id };
}

/* ---------- create_invoice ---------- */

async function executeCreateInvoice(
  userId: string,
  payload: CreateInvoicePayload,
): Promise<ExecutorOutcome> {
  await ensureOrganizationOwner(userId, payload.organizationId);
  await ensureCounterpartyOwner(userId, payload.counterpartyId);

  if (payload.items.length === 0) throw new ExecutorError("Нужна хотя бы одна позиция");

  const itemsInput = payload.items.map((it, idx) => ({
    sortOrder: idx + 1,
    name: it.name,
    unit: it.unit,
    unitCode: "796",
    quantity: it.quantity,
    price: it.price,
    vatRate: vatRateToNumber(it.vatRate),
    nomenclatureId: null,
    countryCode: null,
    countryName: null,
    customsDecl: null,
  }));

  const vatIncluded = true;
  const { prepared, totals } = prepareItems(itemsInput, vatIncluded);
  const date = new Date(payload.date);
  const dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
  const year = date.getFullYear();

  const result = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, userId, payload.organizationId, "INVOICE", year);
    const inv = await tx.invoice.create({
      data: {
        userId,
        organizationId: payload.organizationId,
        counterpartyId: payload.counterpartyId,
        number,
        date,
        dueDate,
        currency: "RUB",
        status: "DRAFT",
        vatRate: prepared[0]?.vatRate ?? 22,
        vatIncluded,
        subtotal: Number(totals.subtotal),
        vatAmount: Number(totals.vatAmount),
        total: Number(totals.total),
        notes: payload.note ?? null,
      },
    });
    await tx.documentItem.createMany({
      data: prepared.map((p) => itemCreateData(p, userId, "INVOICE", inv.id)),
    });
    return inv;
  });

  return { targetType: "invoice", targetId: result.id };
}

/* ---------- Sprint 6B: create_act_from_invoice ---------- */

async function executeCreateActFromInvoice(
  userId: string,
  payload: CreateActFromInvoicePayload,
): Promise<ExecutorOutcome> {
  await ensureOrganizationOwner(userId, payload.organizationId);

  // Загружаем счёт с проверкой ownership и organizationId
  const invoice = await prisma.invoice.findFirst({
    where: { id: payload.invoiceId, userId, organizationId: payload.organizationId },
    include: { items: { orderBy: { sortOrder: "asc" } }, acts: { select: { id: true, number: true } } },
  });
  if (!invoice) throw new ExecutorError("Счёт не найден или принадлежит другому пользователю/организации");
  if (invoice.status === "CANCELLED") throw new ExecutorError("Нельзя создать акт на основании отменённого счёта");
  if (invoice.items.length === 0) throw new ExecutorError("В счёте нет позиций — акт создать невозможно");

  // Защита от дубля: один акт на счёт
  if (invoice.acts.length > 0) {
    const exist = invoice.acts[0]!;
    throw new ExecutorError(`По счёту ${invoice.number} уже создан акт ${exist.number} (id ${exist.id})`);
  }

  const date = payload.date ? new Date(payload.date) : new Date();
  const year = date.getFullYear();

  const created = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, userId, payload.organizationId, "ACT", year);
    const act = await tx.act.create({
      data: {
        userId,
        organizationId: payload.organizationId,
        counterpartyId: invoice.counterpartyId,
        invoiceId: invoice.id,
        contractId: invoice.contractId ?? null,
        number,
        date,
        currency: invoice.currency,
        status: "DRAFT",
        vatRate: invoice.vatRate,
        vatIncluded: invoice.vatIncluded,
        subtotal: invoice.subtotal,
        vatAmount: invoice.vatAmount,
        total: invoice.total,
        notes: payload.note ?? null,
      },
    });
    // Копируем позиции из счёта в акт (с теми же суммами — totals уже посчитаны)
    await tx.documentItem.createMany({
      data: invoice.items.map((it, idx) => ({
        userId,
        documentType: "ACT" as const,
        actId: act.id,
        sortOrder: idx + 1,
        nomenclatureId: it.nomenclatureId ?? null,
        name: it.name,
        unit: it.unit,
        unitCode: it.unitCode,
        quantity: it.quantity,
        price: it.price,
        vatRate: it.vatRate,
        subtotal: it.subtotal,
        vatAmount: it.vatAmount,
        total: it.total,
        countryCode: it.countryCode ?? null,
        countryName: it.countryName ?? null,
        customsDecl: it.customsDecl ?? null,
      })),
    });
    return act;
  });

  return { targetType: "act", targetId: created.id };
}

/* ---------- Sprint 6B: create_contract ---------- */

function nextContractNumber(prefix: string, count: number, year: number): string {
  return `${prefix}-${String(count + 1).padStart(3, "0")}/${year}`;
}

async function executeCreateContract(
  userId: string,
  payload: CreateContractPayload,
): Promise<ExecutorOutcome> {
  await ensureOrganizationOwner(userId, payload.organizationId);
  await ensureCounterpartyOwner(userId, payload.counterpartyId);

  // template (если задан) должен принадлежать пользователю и (если указан) — нужной организации
  let templateId: string | null = null;
  if (payload.templateId) {
    const tpl = await prisma.contractTemplate.findFirst({
      where: { id: payload.templateId, userId },
      select: { id: true, organizationId: true },
    });
    if (!tpl) throw new ExecutorError("Шаблон договора не найден или принадлежит другому пользователю");
    if (tpl.organizationId && tpl.organizationId !== payload.organizationId) {
      throw new ExecutorError("Шаблон договора принадлежит другой организации");
    }
    templateId = tpl.id;
  } else {
    // Если templateId не передан — пытаемся найти default-шаблон организации
    const defaultTpl = await prisma.contractTemplate.findFirst({
      where: {
        userId,
        isDefault: true,
        OR: [{ organizationId: payload.organizationId }, { organizationId: null }],
      },
      orderBy: [{ organizationId: "desc" }], // приоритет — шаблон именно этой организации
      select: { id: true },
    });
    templateId = defaultTpl?.id ?? null;
  }

  const date = payload.date ? new Date(payload.date) : new Date();
  const year = date.getFullYear();

  // Auto-number: D-NNN/YYYY (если не передан явный)
  let number = payload.number?.trim() || null;
  if (!number) {
    const count = await prisma.contract.count({
      where: {
        userId,
        organizationId: payload.organizationId,
        // приблизительный подсчёт за текущий год — для номера. Уникальность гарантирует @@unique([userId, number]) — если коллизия, P2002 вернёт.
        date: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) },
      },
    });
    number = nextContractNumber("Д", count, year);
  }

  const expiryDate = payload.validUntil ? new Date(payload.validUntil) : null;
  // Описание = пользовательские условия, если есть. Шаблон рендерится во вьюшке PDF/preview
  // (lib/contract-template.ts), а не сохраняется отдельным полем — модель Contract этого не предусматривает.
  const description = payload.terms ?? null;

  const contract = await prisma.contract.create({
    data: {
      userId,
      organizationId: payload.organizationId,
      counterpartyId: payload.counterpartyId,
      templateId,
      number,
      date,
      expiryDate,
      subject: payload.subject,
      amount: payload.amount ?? null,
      currency: "RUB",
      status: "ACTIVE",
      autoRenew: false,
      description,
    },
  });
  return { targetType: "contract", targetId: contract.id };
}

/* ---------- Sprint 6B: analyze_debt (read-only) ---------- */

async function executeAnalyzeDebt(userId: string, payload: AnalyzeDebtPayload): Promise<ExecutorOutcome> {
  await ensureOrganizationOwner(userId, payload.organizationId);
  if (payload.counterpartyId) await ensureCounterpartyOwner(userId, payload.counterpartyId);

  const asOfDate = payload.asOfDate ? new Date(payload.asOfDate) : new Date();

  // Загружаем неоплаченные/просроченные счета в области (опц. по контрагенту)
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    userId,
    organizationId: payload.organizationId,
    status: { in: ["DRAFT", "SENT", "PARTIALLY_PAID", "OVERDUE"] },
    ...(payload.counterpartyId ? { counterpartyId: payload.counterpartyId } : {}),
  };
  const invoices = await prisma.invoice.findMany({
    where: invoiceWhere,
    include: {
      counterparty: { select: { id: true, name: true } },
      allocations: { select: { amount: true } },
    },
    orderBy: [{ counterpartyId: "asc" }, { date: "asc" }],
  });

  // Группируем по контрагенту
  const map = new Map<string, DebtAnalysisCounterparty>();
  for (const inv of invoices) {
    const total = Number(inv.total);
    const paid = inv.allocations.reduce((s, a) => s + Number(a.amount), 0);
    const debt = Math.max(0, total - paid);
    if (debt <= 0.005) continue; // полностью оплаченные пропускаем

    const isOverdue = inv.dueDate && inv.dueDate < asOfDate;
    const entry = map.get(inv.counterpartyId) ?? {
      counterpartyId: inv.counterpartyId,
      name: inv.counterparty.name,
      debt: 0,
      overdueDebt: 0,
      unpaidInvoicesCount: 0,
      oldestOverdueDate: null as string | null,
    };
    entry.debt = Math.round((entry.debt + debt) * 100) / 100;
    if (isOverdue) {
      entry.overdueDebt = Math.round((entry.overdueDebt + debt) * 100) / 100;
      const dueIso = inv.dueDate!.toISOString().slice(0, 10);
      if (!entry.oldestOverdueDate || dueIso < entry.oldestOverdueDate) {
        entry.oldestOverdueDate = dueIso;
      }
    }
    entry.unpaidInvoicesCount += 1;
    map.set(inv.counterpartyId, entry);
  }

  const counterparties = [...map.values()].sort((a, b) => b.debt - a.debt);
  const totalDebt = Math.round(counterparties.reduce((s, c) => s + c.debt, 0) * 100) / 100;
  const overdueDebt = Math.round(counterparties.reduce((s, c) => s + c.overdueDebt, 0) * 100) / 100;

  // Detereministic рекомендации (без галлюцинаций)
  const recommendations: string[] = [];
  if (counterparties.length === 0) {
    recommendations.push("Должников нет на указанную дату — нет действий.");
  } else {
    recommendations.push("Связаться с контрагентами с наибольшей задолженностью.");
    if (overdueDebt > 0) recommendations.push("Проверить просроченные счета и направить напоминания.");
    if (counterparties.some((c) => c.overdueDebt > 0)) {
      recommendations.push("Сформировать акт сверки с просроченными контрагентами.");
    }
  }

  const result: DebtAnalysisResult = {
    totalDebt,
    overdueDebt,
    counterparties: counterparties.slice(0, 20),
    recommendations,
    asOfDate: asOfDate.toISOString().slice(0, 10),
  };

  return { targetType: "analysis", targetId: null, result };
}

/* ---------- Sprint 6C: create_payment ---------- */

async function executeCreatePayment(
  userId: string,
  payload: CreatePaymentPayload,
): Promise<ExecutorOutcome> {
  // OUT не имеет allocations — проверка дублирует payments-service, но даёт более понятную ошибку для AI-flow
  if (payload.direction === "OUT" && payload.allocations && payload.allocations.length > 0) {
    throw new ExecutorError("Исходящий платёж (OUT) не может закрывать наши счета — allocations запрещены");
  }

  // Owner-checks делаются внутри createPaymentInTx (organization / counterparty / bankAccount).
  // AI executor лишь оборачивает в транзакцию и передаёт payload как есть.
  const created = await prisma.$transaction(async (tx) => {
    return await createPaymentInTx(tx, userId, {
      organizationId: payload.organizationId,
      counterpartyId: payload.counterpartyId,
      bankAccountId: payload.bankAccountId ?? null,
      date: payload.date,
      amount: payload.amount,
      direction: payload.direction,
      method: payload.method ?? "BANK",
      purpose: payload.purpose ?? null,
      reference: payload.reference ?? null,
      allocations: payload.allocations ?? undefined,
    });
  });

  return { targetType: "payment", targetId: created.id };
}

/* ---------- Sprint 6C: suggest_payment_allocations (read-only) ---------- */

async function executeSuggestPaymentAllocations(
  userId: string,
  payload: SuggestPaymentAllocationsPayload,
): Promise<ExecutorOutcome> {
  await ensureOrganizationOwner(userId, payload.organizationId);
  await ensureCounterpartyOwner(userId, payload.counterpartyId);

  const asOfDate = payload.asOfDate ? new Date(payload.asOfDate) : new Date();

  // Все неоплаченные счета этого контрагента + organization, отсортированные по dueDate, затем date.
  const invoices = await prisma.invoice.findMany({
    where: {
      userId,
      organizationId: payload.organizationId,
      counterpartyId: payload.counterpartyId,
      status: { in: ["DRAFT", "SENT", "PARTIALLY_PAID", "OVERDUE"] },
    },
    include: { allocations: { select: { amount: true } } },
    orderBy: [{ dueDate: "asc" }, { date: "asc" }],
  });

  let remaining = round2(payload.amount);
  const allocations: PaymentSuggestionAllocation[] = [];
  const warnings: string[] = [];

  for (const inv of invoices) {
    if (remaining <= 0.005) break;
    const total = Number(inv.total);
    const alreadyPaid = inv.allocations.reduce((s, a) => s + Number(a.amount), 0);
    const balance = round2(total - alreadyPaid);
    if (balance <= 0.005) continue;

    const suggested = round2(Math.min(remaining, balance));
    const isOverdue = inv.dueDate && inv.dueDate < asOfDate;
    const reason = isOverdue
      ? `Просрочен с ${inv.dueDate!.toISOString().slice(0, 10)} — приоритетное закрытие`
      : "Старейший непогашенный счёт по дате";

    allocations.push({
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      invoiceDate: inv.date.toISOString().slice(0, 10),
      invoiceBalance: balance,
      suggestedAmount: suggested,
      reason,
    });
    remaining = round2(remaining - suggested);
  }

  const allocatedAmount = round2(allocations.reduce((s, a) => s + a.suggestedAmount, 0));
  const advanceAmount = round2(payload.amount - allocatedAmount);

  if (allocations.length === 0) {
    warnings.push("У контрагента нет неоплаченных счетов — вся сумма попадёт в аванс.");
  } else if (advanceAmount > 0.005) {
    warnings.push(`Сумма платежа превышает долг на ${advanceAmount.toFixed(2)} ₽ — этот остаток будет авансом.`);
  }

  const result: PaymentSuggestionResult = {
    amount: round2(payload.amount),
    allocatedAmount,
    advanceAmount,
    allocations,
    warnings,
    asOfDate: asOfDate.toISOString().slice(0, 10),
  };

  return { targetType: "analysis", targetId: null, result };
}

/* ---------- public entry ---------- */

/** Выполняет один action и возвращает результат либо ошибку. */
export async function executeAction(userId: string, action: Action): Promise<ExecutorOutcome> {
  try {
    switch (action.type) {
      case "create_counterparty":
        return await executeCreateCounterparty(userId, action.payload);
      case "create_invoice":
        return await executeCreateInvoice(userId, action.payload);
      case "create_act_from_invoice":
        return await executeCreateActFromInvoice(userId, action.payload);
      case "create_contract":
        return await executeCreateContract(userId, action.payload);
      case "analyze_debt":
        return await executeAnalyzeDebt(userId, action.payload);
      case "create_payment":
        return await executeCreatePayment(userId, action.payload);
      case "suggest_payment_allocations":
        return await executeSuggestPaymentAllocations(userId, action.payload);
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ExecutorError("Конфликт уникальности (вероятно, дубль). Пересмотрите данные.");
    }
    throw err;
  }
}

/** Утилита для удобного формирования FailedAction. */
export function asFailedAction(action: Action, error: unknown): FailedAction {
  const message = error instanceof Error ? error.message : String(error);
  return { id: action.id, actionType: action.type, error: message };
}

/** Преобразует результат executor в AppliedAction. */
export function toAppliedAction(action: Action, outcome: ExecutorOutcome): AppliedAction {
  return {
    id: action.id,
    actionType: action.type,
    targetType: outcome.targetType,
    targetId: outcome.targetId,
    ...(outcome.result ? { result: outcome.result } : {}),
  };
}
