// Расчёт акта сверки взаимных расчётов с контрагентом.
// Базовый принцип: "Дебет" = наши требования (Invoice.total), "Кредит" = поступления (Payment.amount, direction=IN).
// Положительное закрывающее сальдо означает долг контрагента нам.

import { prisma } from "./prisma.js";

export type DebitDocKind = "INVOICE" | "ACT" | "UPD" | "WAYBILL";

export interface ReconciliationLine {
  date: string;            // ISO YYYY-MM-DD
  kind: DebitDocKind | "PAYMENT";
  refId: string;           // id документа/платежа
  number: string;          // номер документа или № п/п
  description: string;     // человекочитаемое описание
  debit: number;           // увеличение долга контрагента (наши документы)
  credit: number;          // уменьшение долга контрагента (поступления)
}

export interface ReconciliationResult {
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  lines: ReconciliationLine[];
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Считает движения и сальдо на период [from, to].
 * - `from` включается, `to` включается (по дате документа).
 * - Учитываются только Invoice (как дебет) и Payment direction=IN (как кредит).
 *   В будущем можно расширить до Act/UPD/Waybill как отдельных дебетов.
 * - Открывающее сальдо = сумма (debit - credit) для документов до периода.
 */
export async function computeReconciliation(
  userId: string,
  organizationId: string,
  counterpartyId: string,
  from: Date,
  to: Date,
): Promise<ReconciliationResult> {
  // 1. Документы и платежи ДО начала периода — для opening balance
  const [preInvoices, prePayments] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId, organizationId, counterpartyId, status: { not: "CANCELLED" }, date: { lt: from } },
      select: { id: true, number: true, date: true, total: true },
    }),
    prisma.payment.findMany({
      where: { userId, organizationId, counterpartyId, direction: "IN", date: { lt: from } },
      select: { id: true, reference: true, date: true, amount: true },
    }),
  ]);
  const openingBalance =
    preInvoices.reduce((s, i) => s + Number(i.total), 0) -
    prePayments.reduce((s, p) => s + Number(p.amount), 0);

  // 2. Документы и платежи В периоде
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId, organizationId, counterpartyId, status: { not: "CANCELLED" }, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      select: { id: true, number: true, date: true, total: true },
    }),
    prisma.payment.findMany({
      where: { userId, organizationId, counterpartyId, direction: "IN", date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      select: { id: true, reference: true, purpose: true, date: true, amount: true },
    }),
  ]);

  const lines: ReconciliationLine[] = [];
  for (const inv of invoices) {
    lines.push({
      date: ymd(inv.date),
      kind: "INVOICE",
      refId: inv.id,
      number: inv.number,
      description: `Счёт № ${inv.number}`,
      debit: Number(inv.total),
      credit: 0,
    });
  }
  for (const p of payments) {
    lines.push({
      date: ymd(p.date),
      kind: "PAYMENT",
      refId: p.id,
      number: p.reference ?? "—",
      description: p.purpose ?? `Поступление${p.reference ? ` № ${p.reference}` : ""}`,
      debit: 0,
      credit: Number(p.amount),
    });
  }
  // сортировка: по дате, потом дебет до кредита (счета раньше платежей в один день)
  lines.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.debit > 0 ? -1 : 1;
  });

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const closingBalance = openingBalance + totalDebit - totalCredit;

  return {
    openingBalance: round2(openingBalance),
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
    closingBalance: round2(closingBalance),
    lines: lines.map((l) => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
