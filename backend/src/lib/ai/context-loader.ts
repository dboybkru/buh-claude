// Sprint 6A: подгрузка контекста для AI.
// Возвращает только данные текущего пользователя — никогда не утекают чужие
// записи. Объём строго лимитирован. apiKey / зашифрованные секреты НЕ передаются.

import { prisma } from "../prisma.js";

export type AiContextScope = "global" | "organization";

export interface AiContextOrganization {
  id: string;
  name: string;
  fullName: string;
  inn: string;
  kpp: string | null;
  vatMode: string;
}

export interface AiContextCounterparty {
  id: string;
  name: string;
  inn: string;
  kpp: string | null;
}

export interface AiContextInvoice {
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  total: string;
  status: string;
  counterpartyId: string;
  counterpartyName: string;
}

export interface AiContextPayment {
  id: string;
  date: string;
  amount: string;
  direction: string;
  counterpartyName: string | null;
  purpose: string | null;
}

export interface AiContext {
  user: { id: string; email: string; fullName: string };
  organizations: AiContextOrganization[];
  selectedOrganization: AiContextOrganization | null;
  counterparties: AiContextCounterparty[];
  recentInvoices: AiContextInvoice[];
  unpaidInvoices: AiContextInvoice[];
  recentPayments: AiContextPayment[];
  today: string;
}

const LIMIT = 20;

/**
 * Загружает контекст для AI. organizationId опциональный; если задан и scope=organization —
 * подтянет связанные с этой организацией данные.
 */
export async function loadAiContext(args: {
  userId: string;
  organizationId?: string | null;
  scope?: AiContextScope;
}): Promise<AiContext> {
  const { userId } = args;
  const scope = args.scope ?? "global";

  const [user, orgs] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, fullName: true } }),
    prisma.organization.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, fullName: true, inn: true, kpp: true, vatMode: true },
    }),
  ]);

  let selectedOrganization: AiContextOrganization | null = null;
  let counterparties: AiContextCounterparty[] = [];
  let recentInvoices: AiContextInvoice[] = [];
  let unpaidInvoices: AiContextInvoice[] = [];
  let recentPayments: AiContextPayment[] = [];

  if (args.organizationId && scope === "organization") {
    selectedOrganization = orgs.find((o) => o.id === args.organizationId) ?? null;
    if (selectedOrganization) {
      const [cps, recInv, unpaidInv, recPay] = await Promise.all([
        // Контрагенты пользователя (per-user в этом проекте) — лимит 20 самых свежих
        prisma.counterparty.findMany({
          where: { userId },
          take: LIMIT,
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, inn: true, kpp: true },
        }),
        prisma.invoice.findMany({
          where: { userId, organizationId: selectedOrganization.id },
          take: LIMIT,
          orderBy: { date: "desc" },
          select: {
            id: true, number: true, date: true, dueDate: true, total: true, status: true,
            counterparty: { select: { id: true, name: true } },
          },
        }),
        prisma.invoice.findMany({
          where: {
            userId,
            organizationId: selectedOrganization.id,
            status: { in: ["DRAFT", "SENT", "PARTIALLY_PAID", "OVERDUE"] },
          },
          take: LIMIT,
          orderBy: { dueDate: "asc" },
          select: {
            id: true, number: true, date: true, dueDate: true, total: true, status: true,
            counterparty: { select: { id: true, name: true } },
          },
        }),
        prisma.payment.findMany({
          where: { userId, organizationId: selectedOrganization.id },
          take: LIMIT,
          orderBy: { date: "desc" },
          select: {
            id: true, date: true, amount: true, direction: true, purpose: true,
            counterparty: { select: { name: true } },
          },
        }),
      ]);
      counterparties = cps;
      recentInvoices = recInv.map((i) => ({
        id: i.id, number: i.number,
        date: i.date.toISOString().slice(0, 10),
        dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
        total: i.total.toString(), status: i.status,
        counterpartyId: i.counterparty.id, counterpartyName: i.counterparty.name,
      }));
      unpaidInvoices = unpaidInv.map((i) => ({
        id: i.id, number: i.number,
        date: i.date.toISOString().slice(0, 10),
        dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : null,
        total: i.total.toString(), status: i.status,
        counterpartyId: i.counterparty.id, counterpartyName: i.counterparty.name,
      }));
      recentPayments = recPay.map((p) => ({
        id: p.id,
        date: p.date.toISOString().slice(0, 10),
        amount: p.amount.toString(),
        direction: p.direction,
        counterpartyName: p.counterparty?.name ?? null,
        purpose: p.purpose,
      }));
    }
  }

  return {
    user,
    organizations: orgs,
    selectedOrganization,
    counterparties,
    recentInvoices,
    unpaidInvoices,
    recentPayments,
    today: new Date().toISOString().slice(0, 10),
  };
}

/** Сериализует контекст в компактную system-prompt-friendly строку.
 *  MockAIProvider парсит из неё organizationId, counterpartyId и today. */
export function formatContextForPrompt(ctx: AiContext): string {
  const lines: string[] = [];
  lines.push(`Контекст пользователя: userId="${ctx.user.id}"; today="${ctx.today}".`);
  if (ctx.selectedOrganization) {
    lines.push(`Выбранная организация: organizationId="${ctx.selectedOrganization.id}"; name="${ctx.selectedOrganization.name}"; inn="${ctx.selectedOrganization.inn}"; vatMode="${ctx.selectedOrganization.vatMode}".`);
  } else {
    lines.push(`Выбранная организация: не задана. Используй organizationId из списка организаций ниже.`);
  }
  if (ctx.organizations.length > 0) {
    lines.push(`Все организации пользователя (${ctx.organizations.length}):`);
    ctx.organizations.forEach((o) => lines.push(`  - id="${o.id}" name="${o.name}" inn="${o.inn}"`));
  }
  if (ctx.counterparties.length > 0) {
    lines.push(`Контрагенты (${ctx.counterparties.length}, до ${LIMIT}):`);
    ctx.counterparties.forEach((c) => lines.push(`  - counterpartyId="${c.id}" name="${c.name}" inn="${c.inn}"`));
  }
  if (ctx.unpaidInvoices.length > 0) {
    lines.push(`Неоплаченные счета (${ctx.unpaidInvoices.length}):`);
    ctx.unpaidInvoices.forEach((i) =>
      lines.push(`  - number="${i.number}" total=${i.total} status=${i.status} due=${i.dueDate ?? "—"} cp="${i.counterpartyName}"`),
    );
  }
  if (ctx.recentInvoices.length > 0) {
    lines.push(`Последние счета (${ctx.recentInvoices.length}):`);
    ctx.recentInvoices.slice(0, 10).forEach((i) =>
      lines.push(`  - number="${i.number}" date=${i.date} total=${i.total} status=${i.status} cp="${i.counterpartyName}"`),
    );
  }
  if (ctx.recentPayments.length > 0) {
    lines.push(`Последние платежи (${ctx.recentPayments.length}):`);
    ctx.recentPayments.slice(0, 10).forEach((p) =>
      lines.push(`  - date=${p.date} amount=${p.amount} ${p.direction} cp="${p.counterpartyName ?? "—"}"`),
    );
  }
  return lines.join("\n");
}
