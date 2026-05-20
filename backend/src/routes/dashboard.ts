import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

interface RevenueByMonthRow {
  month: Date;
  revenue: string | number;
}

interface TopCounterpartyRow {
  counterpartyId: string;
  name: string;
  inn: string;
  total: string | number;
  count: bigint;
}

function toNumber(v: string | number | bigint | null | undefined): number {
  if (v == null) return 0;
  if (typeof v === "bigint") return Number(v);
  return typeof v === "number" ? v : parseFloat(v);
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    const userId = request.user.sub;
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // 1. Счета по статусам + сумма
    const invoicesByStatus = await prisma.invoice.groupBy({
      by: ["status"],
      where: { userId },
      _count: { _all: true },
      _sum: { total: true },
    });

    // 2. Документы по типам
    const [actsCount, updsCount, waybillsCount] = await Promise.all([
      prisma.act.count({ where: { userId } }),
      prisma.updDocument.count({ where: { userId } }),
      prisma.waybill.count({ where: { userId } }),
    ]);

    // 3. Выручка за текущий год (оплаченные счета) — общая и за этот месяц
    const [revenueYearAgg, revenueMonthAgg] = await Promise.all([
      prisma.invoice.aggregate({
        where: { userId, status: "PAID", paidAt: { gte: yearStart } },
        _sum: { total: true },
      }),
      prisma.invoice.aggregate({
        where: { userId, status: "PAID", paidAt: { gte: monthStart } },
        _sum: { total: true },
      }),
    ]);

    // 4. Выручка по месяцам (последние 12) — оплаченные счета по paidAt
    // Используем сырой SQL: date_trunc('month', "paidAt") AS month
    const revenueByMonth = await prisma.$queryRaw<RevenueByMonthRow[]>(Prisma.sql`
      SELECT
        date_trunc('month', "paidAt") AS month,
        COALESCE(SUM(total), 0) AS revenue
      FROM "Invoice"
      WHERE "userId" = ${userId}
        AND status = 'PAID'
        AND "paidAt" >= ${new Date(now.getFullYear() - 1, now.getMonth() + 1, 1)}
      GROUP BY date_trunc('month', "paidAt")
      ORDER BY month ASC
    `);

    // 5. Топ-5 контрагентов по обороту (по всем счетам, не только оплаченным)
    const topCounterparties = await prisma.$queryRaw<TopCounterpartyRow[]>(Prisma.sql`
      SELECT
        i."counterpartyId" AS "counterpartyId",
        c.name AS name,
        c.inn AS inn,
        COALESCE(SUM(i.total), 0) AS total,
        COUNT(*)::bigint AS count
      FROM "Invoice" i
      JOIN "Counterparty" c ON c.id = i."counterpartyId"
      WHERE i."userId" = ${userId}
      GROUP BY i."counterpartyId", c.name, c.inn
      ORDER BY total DESC
      LIMIT 5
    `);

    // 6. Договоры с истекающим сроком (30 дней) и просроченные ACTIVE
    const [expiring, expired] = await Promise.all([
      prisma.contract.findMany({
        where: {
          userId,
          status: "ACTIVE",
          expiryDate: { gte: now, lte: in30Days },
        },
        orderBy: { expiryDate: "asc" },
        include: { counterparty: { select: { id: true, name: true, inn: true } } },
        take: 10,
      }),
      prisma.contract.findMany({
        where: { userId, status: "ACTIVE", expiryDate: { lt: now } },
        orderBy: { expiryDate: "desc" },
        include: { counterparty: { select: { id: true, name: true, inn: true } } },
        take: 10,
      }),
    ]);

    // 7. Просроченные счета (DRAFT/SENT/OVERDUE с dueDate < сегодня и не оплачены)
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        userId,
        status: { in: ["DRAFT", "SENT", "OVERDUE", "PARTIALLY_PAID"] },
        dueDate: { lt: now },
      },
      orderBy: { dueDate: "asc" },
      include: { counterparty: { select: { id: true, name: true, inn: true } } },
      take: 10,
    });

    // 8. Счётчики
    const [orgs, counterparties, contracts] = await Promise.all([
      prisma.organization.count({ where: { userId } }),
      prisma.counterparty.count({ where: { userId } }),
      prisma.contract.count({ where: { userId } }),
    ]);

    // 9. Топ должников (по сумме открытого долга по счетам)
    const topDebtors = await prisma.$queryRaw<Array<{ counterpartyId: string; name: string; inn: string; debt: string | number; invoices: bigint }>>(Prisma.sql`
      SELECT
        i."counterpartyId"                                      AS "counterpartyId",
        c.name                                                  AS name,
        c.inn                                                   AS inn,
        SUM(i.total - COALESCE(paid.amount, 0))                 AS debt,
        COUNT(*)::bigint                                        AS invoices
      FROM "Invoice" i
      JOIN "Counterparty" c ON c.id = i."counterpartyId"
      LEFT JOIN (
        SELECT "invoiceId", SUM(amount) AS amount
        FROM "PaymentAllocation"
        GROUP BY "invoiceId"
      ) paid ON paid."invoiceId" = i.id
      WHERE i."userId" = ${userId}
        AND i.status IN ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND (i.total - COALESCE(paid.amount, 0)) > 0
      GROUP BY i."counterpartyId", c.name, c.inn
      ORDER BY debt DESC
      LIMIT 5
    `);

    // 10. Ближайшие платежи (счета с dueDate в ближайшие 14 дней, не оплаченные)
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const upcomingPayments = await prisma.invoice.findMany({
      where: {
        userId,
        status: { in: ["SENT", "PARTIALLY_PAID"] },
        dueDate: { gte: now, lte: in14Days },
      },
      orderBy: { dueDate: "asc" },
      include: { counterparty: { select: { id: true, name: true, inn: true } } },
      take: 10,
    });

    return {
      counters: {
        organizations: orgs,
        counterparties,
        contracts,
        invoices: invoicesByStatus.reduce((s, x) => s + x._count._all, 0),
        acts: actsCount,
        upds: updsCount,
        waybills: waybillsCount,
      },
      invoices: {
        byStatus: invoicesByStatus.map((s) => ({
          status: s.status,
          count: s._count._all,
          total: toNumber(s._sum.total?.toString() ?? null),
        })),
      },
      revenue: {
        year: toNumber(revenueYearAgg._sum.total?.toString() ?? null),
        month: toNumber(revenueMonthAgg._sum.total?.toString() ?? null),
        byMonth: revenueByMonth.map((r) => ({
          month: r.month instanceof Date ? r.month.toISOString().slice(0, 7) : String(r.month).slice(0, 7),
          revenue: toNumber(r.revenue),
        })),
      },
      topCounterparties: topCounterparties.map((c) => ({
        counterpartyId: c.counterpartyId,
        name: c.name,
        inn: c.inn,
        total: toNumber(c.total),
        count: Number(c.count),
      })),
      contracts: {
        expiringSoon: expiring,
        expired,
      },
      overdueInvoices,
      topDebtors: topDebtors.map((d) => ({
        counterpartyId: d.counterpartyId,
        name: d.name,
        inn: d.inn,
        debt: toNumber(d.debt),
        invoices: Number(d.invoices),
      })),
      upcomingPayments,
    };
  });
}
