import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";
import { Errors } from "../lib/api-error.js";
import { recalcInvoiceStatus } from "../lib/invoice-status.js";

const directionEnum = z.enum(["IN", "OUT"]);
const methodEnum = z.enum(["BANK", "CASH", "CARD", "OTHER"]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата ГГГГ-ММ-ДД");

const baseShape = {
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid().optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  invoiceId: z.string().uuid().optional().nullable(),  // упрощение MVP: один платёж → один счёт
  date: dateString,
  amount: z.coerce.number().positive("Сумма должна быть положительной"),
  direction: directionEnum.default("IN"),
  method: methodEnum.default("BANK"),
  purpose: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
};

const createSchema = z.object(baseShape);
const updateSchema = z.object(baseShape).partial();

export async function paymentsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const userId = request.user.sub;

    const extraFilters = z
      .object({
        counterpartyId: z.string().uuid().optional(),
        organizationId: z.string().uuid().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        direction: directionEnum.optional(),
      })
      .parse(request.query);

    const where: Prisma.PaymentWhereInput = {
      userId,
      ...(extraFilters.counterpartyId ? { counterpartyId: extraFilters.counterpartyId } : {}),
      ...(extraFilters.organizationId ? { organizationId: extraFilters.organizationId } : {}),
      ...(extraFilters.direction ? { direction: extraFilters.direction } : {}),
      ...(extraFilters.from || extraFilters.to
        ? {
            date: {
              ...(extraFilters.from ? { gte: new Date(extraFilters.from) } : {}),
              ...(extraFilters.to ? { lte: new Date(extraFilters.to) } : {}),
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { purpose: { contains: q.q, mode: "insensitive" } },
              { reference: { contains: q.q, mode: "insensitive" } },
              { counterparty: { name: { contains: q.q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const orderBy = parseSort(q.sort, ["date", "amount", "createdAt"], { date: "desc" });
    const [items, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy,
        include: {
          organization: { select: { id: true, name: true } },
          counterparty: { select: { id: true, name: true, inn: true } },
          bankAccount: { select: { id: true, bankName: true, bik: true } },
          allocations: { include: { invoice: { select: { id: true, number: true, status: true, total: true } } } },
        },
      }),
      prisma.payment.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const p = await prisma.payment.findFirst({
      where: { id, userId: request.user.sub },
      include: {
        organization: true,
        counterparty: true,
        bankAccount: true,
        allocations: { include: { invoice: true } },
      },
    });
    if (!p) throw Errors.notFound("Платёж");
    return p;
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные поля платежа", parsed.error.flatten());
    const userId = request.user.sub;
    const data = parsed.data;

    // Проверки на принадлежность сущностей юзеру
    const org = await prisma.organization.findFirst({ where: { id: data.organizationId, userId } });
    if (!org) throw Errors.validation("Организация не найдена");
    if (data.counterpartyId) {
      const cp = await prisma.counterparty.findFirst({ where: { id: data.counterpartyId, userId } });
      if (!cp) throw Errors.validation("Контрагент не найден");
    }
    if (data.invoiceId) {
      const inv = await prisma.invoice.findFirst({ where: { id: data.invoiceId, userId } });
      if (!inv) throw Errors.validation("Счёт не найден");
      // OUT — расход, не оплата нашего счёта. Не позволяем такую связку.
      if (data.direction === "OUT") throw Errors.validation("Исходящий платёж (OUT) не может закрывать счёт, выставленный нами");
      // Счёт и платёж должны быть на одну организацию
      if (inv.organizationId !== data.organizationId) throw Errors.validation("Счёт принадлежит другой организации");
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId,
          organizationId: data.organizationId,
          counterpartyId: data.counterpartyId ?? null,
          bankAccountId: data.bankAccountId ?? null,
          date: new Date(data.date),
          amount: data.amount,
          direction: data.direction,
          method: data.method,
          purpose: data.purpose ?? null,
          reference: data.reference ?? null,
          notes: data.notes ?? null,
        },
      });
      if (data.invoiceId) {
        await tx.paymentAllocation.create({
          data: { paymentId: payment.id, invoiceId: data.invoiceId, amount: data.amount },
        });
        await recalcInvoiceStatus(tx, data.invoiceId);
      }
      return payment;
    });

    return reply.code(201).send(result);
  });

  app.patch("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные поля платежа", parsed.error.flatten());
    const existing = await prisma.payment.findFirst({
      where: { id, userId: request.user.sub },
      include: { allocations: true },
    });
    if (!existing) throw Errors.notFound("Платёж");
    const data = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.update({
        where: { id },
        data: {
          ...(data.organizationId !== undefined ? { organizationId: data.organizationId } : {}),
          ...(data.counterpartyId !== undefined ? { counterpartyId: data.counterpartyId } : {}),
          ...(data.bankAccountId !== undefined ? { bankAccountId: data.bankAccountId } : {}),
          ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
          ...(data.amount !== undefined ? { amount: data.amount } : {}),
          ...(data.direction !== undefined ? { direction: data.direction } : {}),
          ...(data.method !== undefined ? { method: data.method } : {}),
          ...(data.purpose !== undefined ? { purpose: data.purpose } : {}),
          ...(data.reference !== undefined ? { reference: data.reference } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        },
      });

      // Если сумма платежа изменилась — обновим аллокации пропорционально
      // (MVP: один платёж = одна аллокация — просто синхронизируем)
      if (data.amount !== undefined && existing.allocations.length === 1) {
        const alloc = existing.allocations[0]!;
        await tx.paymentAllocation.update({ where: { id: alloc.id }, data: { amount: data.amount } });
      }

      const affectedInvoiceIds = Array.from(new Set(existing.allocations.map((a) => a.invoiceId)));
      for (const invId of affectedInvoiceIds) await recalcInvoiceStatus(tx, invId);
      return p;
    });
    return updated;
  });

  app.delete("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await prisma.payment.findFirst({
      where: { id, userId: request.user.sub },
      include: { allocations: true },
    });
    if (!existing) throw Errors.notFound("Платёж");

    await prisma.$transaction(async (tx) => {
      const affected = Array.from(new Set(existing.allocations.map((a) => a.invoiceId)));
      await tx.payment.delete({ where: { id } });
      for (const invId of affected) await recalcInvoiceStatus(tx, invId);
    });
    return { ok: true };
  });

  // Платежи по конкретному счёту
  app.get("/by-invoice/:invoiceId", async (request) => {
    const { invoiceId } = z.object({ invoiceId: z.string().uuid() }).parse(request.params);
    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, userId: request.user.sub } });
    if (!invoice) throw Errors.notFound("Счёт");
    const allocations = await prisma.paymentAllocation.findMany({
      where: { invoiceId },
      include: { payment: true },
      orderBy: { payment: { date: "asc" } },
    });
    const totalPaid = allocations.reduce((s, a) => s + Number(a.amount), 0);
    const total = Number(invoice.total);
    return {
      invoiceId,
      total,
      paid: totalPaid,
      balance: Math.max(0, total - totalPaid),
      allocations,
    };
  });
}
