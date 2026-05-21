// Агрегированная выписка по контрагенту:
// - реквизиты;
// - связанные договоры, счета, акты, платежи;
// - финансовые тоталы: выставлено / оплачено / распределено / нераспределённый аванс / долг / просроченный долг.
//
// Принципы:
// - "invoiced" — сумма счетов (status != CANCELLED).
// - "paid" — сумма всех IN-платежей этого контрагента (всё, что мы получили).
// - "allocated" — сумма аллокаций IN-платежей на наши счета.
// - "unallocatedAdvance" = max(0, paid - allocated). Сюда же попадают
//   платежи без счёта (без allocations вовсе) и любой неразнесённый остаток.
// - "debt" = invoiced - allocated. Положительное = долг контрагента нам.
//           Если есть нераспределённый аванс — он не уменьшает дебеторку до тех пор,
//           пока не привязан к счёту (это сознательно: бухгалтер должен сам разнести).
// - "overdueDebt" — доля непогашенных счетов с dueDate < today.
//
// Параметр organizationId необязательный: если задан — фильтруем по нему все суммы и списки.

import { prisma } from "./prisma.js";

export interface CounterpartyTotals {
  invoiced: number;
  paid: number;
  allocated: number;
  unallocatedAdvance: number;
  debt: number;
  overdueDebt: number;
}

export interface CounterpartyStatementInvoice {
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  status: string;
  total: number;
  paid: number;
  balance: number;
  organizationId: string;
  organization?: { id: string; name: string } | null;
}

export interface CounterpartyStatementPayment {
  id: string;
  date: string;
  amount: number;
  direction: "IN" | "OUT";
  method: string;
  reference: string | null;
  purpose: string | null;
  organizationId: string;
  organization?: { id: string; name: string } | null;
  allocations: Array<{ invoiceId: string; invoiceNumber: string; amount: number }>;
  unallocatedAmount: number;
}

export interface CounterpartyStatementContract {
  id: string;
  number: string;
  date: string;
  expiryDate: string | null;
  amount: number | null;
  currency: string;
  status: string;
  organizationId: string;
}

export interface CounterpartyStatementAct {
  id: string;
  number: string;
  date: string;
  total: number;
  status: string;
  invoiceId: string | null;
  organizationId: string;
}

export interface CounterpartyStatement {
  counterparty: {
    id: string; type: string; name: string; fullName: string | null;
    inn: string; kpp: string | null; ogrn: string | null;
    legalAddress: string | null; actualAddress: string | null;
    managementName: string | null; managementPos: string | null;
    email: string | null; phone: string | null; website: string | null;
    bankAccounts: unknown;
    isActive: boolean; notes: string | null;
  };
  totals: CounterpartyTotals;
  invoices: CounterpartyStatementInvoice[];
  payments: CounterpartyStatementPayment[];
  contracts: CounterpartyStatementContract[];
  acts: CounterpartyStatementAct[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function buildCounterpartyStatement(params: {
  userId: string;
  counterpartyId: string;
  organizationId?: string | null;
}): Promise<CounterpartyStatement> {
  const { userId, counterpartyId, organizationId } = params;

  const cp = await prisma.counterparty.findFirst({
    where: { id: counterpartyId, userId },
  });
  if (!cp) {
    const err: Error & { code?: string; statusCode?: number } = new Error("Контрагент не найден");
    err.code = "NotFound"; err.statusCode = 404;
    throw err;
  }

  const orgFilter = organizationId ? { organizationId } : {};

  const [invoices, payments, contracts, acts] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId, counterpartyId, ...orgFilter },
      orderBy: { date: "desc" },
      select: {
        id: true, number: true, date: true, dueDate: true, status: true, total: true, organizationId: true,
        organization: { select: { id: true, name: true } },
        allocations: { select: { amount: true } },
      },
    }),
    prisma.payment.findMany({
      where: { userId, counterpartyId, ...orgFilter },
      orderBy: { date: "desc" },
      include: {
        organization: { select: { id: true, name: true } },
        allocations: { include: { invoice: { select: { id: true, number: true } } } },
      },
    }),
    prisma.contract.findMany({
      where: { userId, counterpartyId, ...orgFilter },
      orderBy: { date: "desc" },
      select: { id: true, number: true, date: true, expiryDate: true, amount: true, currency: true, status: true, organizationId: true },
    }),
    prisma.act.findMany({
      where: { userId, counterpartyId, ...orgFilter },
      orderBy: { date: "desc" },
      select: { id: true, number: true, date: true, total: true, status: true, invoiceId: true, organizationId: true },
    }),
  ]);

  // Тоталы
  const today = new Date(); today.setHours(0, 0, 0, 0);

  let invoiced = 0;
  let allocated = 0;
  let overdueDebt = 0;
  const invoicesOut: CounterpartyStatementInvoice[] = [];
  for (const inv of invoices) {
    if (inv.status !== "CANCELLED") invoiced += Number(inv.total);
    const paid = inv.allocations.reduce((s, a) => s + Number(a.amount), 0);
    allocated += paid;
    const balance = Math.max(0, Number(inv.total) - paid);
    if (inv.status !== "CANCELLED" && inv.dueDate && new Date(inv.dueDate) < today && balance > 0.005) {
      overdueDebt += balance;
    }
    invoicesOut.push({
      id: inv.id,
      number: inv.number,
      date: ymd(inv.date),
      dueDate: inv.dueDate ? ymd(inv.dueDate) : null,
      status: inv.status,
      total: round2(Number(inv.total)),
      paid: round2(paid),
      balance: round2(balance),
      organizationId: inv.organizationId,
      organization: inv.organization,
    });
  }

  let paid = 0;
  const paymentsOut: CounterpartyStatementPayment[] = [];
  for (const p of payments) {
    if (p.direction === "IN") paid += Number(p.amount);
    const allocs = p.allocations.map((a) => ({ invoiceId: a.invoiceId, invoiceNumber: a.invoice.number, amount: Number(a.amount) }));
    const allocSum = allocs.reduce((s, a) => s + a.amount, 0);
    paymentsOut.push({
      id: p.id,
      date: ymd(p.date),
      amount: round2(Number(p.amount)),
      direction: p.direction,
      method: p.method,
      reference: p.reference,
      purpose: p.purpose,
      organizationId: p.organizationId,
      organization: p.organization,
      allocations: allocs.map((a) => ({ ...a, amount: round2(a.amount) })),
      unallocatedAmount: p.direction === "IN" ? round2(Math.max(0, Number(p.amount) - allocSum)) : 0,
    });
  }

  const unallocatedAdvance = Math.max(0, paid - allocated);
  const debt = invoiced - allocated;

  return {
    counterparty: {
      id: cp.id, type: cp.type, name: cp.name, fullName: cp.fullName,
      inn: cp.inn, kpp: cp.kpp, ogrn: cp.ogrn,
      legalAddress: cp.legalAddress, actualAddress: cp.actualAddress,
      managementName: cp.managementName, managementPos: cp.managementPos,
      email: cp.email, phone: cp.phone, website: cp.website,
      bankAccounts: cp.bankAccounts,
      isActive: cp.isActive, notes: cp.notes,
    },
    totals: {
      invoiced: round2(invoiced),
      paid: round2(paid),
      allocated: round2(allocated),
      unallocatedAdvance: round2(unallocatedAdvance),
      debt: round2(debt),
      overdueDebt: round2(overdueDebt),
    },
    invoices: invoicesOut,
    payments: paymentsOut,
    contracts: contracts.map((c) => ({
      id: c.id, number: c.number, date: ymd(c.date),
      expiryDate: c.expiryDate ? ymd(c.expiryDate) : null,
      amount: c.amount != null ? round2(Number(c.amount)) : null,
      currency: c.currency, status: c.status, organizationId: c.organizationId,
    })),
    acts: acts.map((a) => ({
      id: a.id, number: a.number, date: ymd(a.date),
      total: round2(Number(a.total)), status: a.status,
      invoiceId: a.invoiceId, organizationId: a.organizationId,
    })),
  };
}
