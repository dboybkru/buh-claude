import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";
import { Errors } from "../lib/api-error.js";
import { recalcInvoiceStatus } from "../lib/invoice-status.js";
import {
  createPaymentInTx,
  normalizeAllocations,
  validateAllocations,
  round2,
} from "../lib/payments-service.js";
import { getUserOrgIds, requireOrgAccess } from "../lib/org-access.js";

const directionEnum = z.enum(["IN", "OUT"]);
const methodEnum = z.enum(["BANK", "CASH", "CARD", "OTHER"]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата ГГГГ-ММ-ДД");

const allocationInputSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.coerce.number().positive("Сумма аллокации должна быть > 0"),
});

const baseShape = {
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid().optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  // legacy: одиночный счёт (один платёж → один счёт)
  invoiceId: z.string().uuid().optional().nullable(),
  // multi-allocation: один платёж → несколько счетов
  allocations: z.array(allocationInputSchema).optional(),
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

// Бизнес-логика (normalizeAllocations / validateAllocations / round2 / createPaymentInTx)
// вынесена в lib/payments-service.ts — используется также модулем bank-import.

/**
 * Подгружает каждый allocation детальной информацией о счёте (number, status, total,
 * текущим paid и balance — на момент запроса).
 */
async function hydrateAllocations(
  paymentIds: string[],
): Promise<Map<string, Array<{ id: string; invoiceId: string; amount: number; invoice: { id: string; number: string; status: string; total: number; paid: number; balance: number } }>>> {
  if (paymentIds.length === 0) return new Map();
  const allocs = await prisma.paymentAllocation.findMany({
    where: { paymentId: { in: paymentIds } },
    include: {
      invoice: {
        select: {
          id: true, number: true, status: true, total: true,
          allocations: { select: { amount: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<string, ReturnType<typeof hydrateAllocationsRow>[]>();
  for (const a of allocs) {
    const row = hydrateAllocationsRow(a);
    const arr = map.get(a.paymentId) ?? [];
    arr.push(row);
    map.set(a.paymentId, arr);
  }
  return map;
}

function hydrateAllocationsRow(a: {
  id: string; paymentId: string; invoiceId: string; amount: Prisma.Decimal;
  invoice: { id: string; number: string; status: string; total: Prisma.Decimal; allocations: Array<{ amount: Prisma.Decimal }> };
}): { id: string; invoiceId: string; amount: number; invoice: { id: string; number: string; status: string; total: number; paid: number; balance: number } } {
  const total = Number(a.invoice.total);
  const paid = a.invoice.allocations.reduce((s, x) => s + Number(x.amount), 0);
  return {
    id: a.id,
    invoiceId: a.invoiceId,
    amount: Number(a.amount),
    invoice: {
      id: a.invoice.id,
      number: a.invoice.number,
      status: a.invoice.status,
      total: round2(total),
      paid: round2(paid),
      balance: round2(Math.max(0, total - paid)),
    },
  };
}

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

    const orgIds = await getUserOrgIds(prisma, userId);
    const where: Prisma.PaymentWhereInput = {
      organizationId: extraFilters.organizationId
        ? { in: orgIds.includes(extraFilters.organizationId) ? [extraFilters.organizationId] : [] }
        : { in: orgIds },
      ...(extraFilters.counterpartyId ? { counterpartyId: extraFilters.counterpartyId } : {}),
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
        },
      }),
      prisma.payment.count({ where }),
    ]);

    const allocMap = await hydrateAllocations(items.map((p) => p.id));
    const withAllocs = items.map((p) => {
      const allocs = allocMap.get(p.id) ?? [];
      const allocSum = round2(allocs.reduce((s, a) => s + a.amount, 0));
      const unallocated = round2(Math.max(0, Number(p.amount) - allocSum));
      return { ...p, allocations: allocs, allocatedAmount: allocSum, unallocatedAmount: unallocated };
    });
    return paginate(withAllocs, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const p = await prisma.payment.findFirst({
      where: { id, organizationId: { in: orgIds } },
      include: {
        organization: true,
        counterparty: true,
        bankAccount: true,
      },
    });
    if (!p) throw Errors.notFound("Платёж");
    const allocMap = await hydrateAllocations([p.id]);
    const allocs = allocMap.get(p.id) ?? [];
    const allocSum = round2(allocs.reduce((s, a) => s + a.amount, 0));
    const unallocated = round2(Math.max(0, Number(p.amount) - allocSum));
    return { ...p, allocations: allocs, allocatedAmount: allocSum, unallocatedAmount: unallocated };
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные поля платежа", parsed.error.flatten());
    const userId = request.user.sub;
    const data = parsed.data;

    await requireOrgAccess(prisma, userId, data.organizationId, "payments:write");
    const orgRow = await prisma.organization.findUnique({
      where: { id: data.organizationId },
      select: { userId: true },
    });
    const ownerUserId = orgRow?.userId ?? userId;

    const result = await prisma.$transaction((tx) =>
      createPaymentInTx(tx, ownerUserId, {
        organizationId: data.organizationId,
        counterpartyId: data.counterpartyId ?? null,
        bankAccountId: data.bankAccountId ?? null,
        date: data.date,
        amount: data.amount,
        direction: data.direction,
        method: data.method,
        purpose: data.purpose ?? null,
        reference: data.reference ?? null,
        notes: data.notes ?? null,
        allocations: data.allocations,
        invoiceId: data.invoiceId ?? null,
      }),
    );

    return reply.code(201).send(result);
  });

  app.patch("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные поля платежа", parsed.error.flatten());
    const existing = await prisma.payment.findFirst({
      where: { id },
      include: { allocations: true },
    });
    if (!existing) throw Errors.notFound("Платёж");
    await requireOrgAccess(prisma, request.user.sub, existing.organizationId, "payments:write");
    const data = parsed.data;

    // Что меняется: если allocations/invoiceId переданы — заменяем. Иначе сохраняем как есть и при изменении
    // суммы платежа просто синхронизируем единственный allocation (legacy).
    const body = request.body as Record<string, unknown> | null;
    const allocationsTouched =
      !!body && (Object.prototype.hasOwnProperty.call(body, "allocations") ||
        Object.prototype.hasOwnProperty.call(body, "invoiceId"));

    const newOrgId = data.organizationId ?? existing.organizationId;
    const newCpId = data.counterpartyId !== undefined ? data.counterpartyId : existing.counterpartyId;
    const newDirection = data.direction ?? existing.direction;
    const newAmount = data.amount ?? Number(existing.amount);

    const previousAffected = Array.from(new Set(existing.allocations.map((a) => a.invoiceId)));

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

      let newAllocations: Array<{ invoiceId: string; amount: number }>;
      if (allocationsTouched) {
        newAllocations = normalizeAllocations(data.allocations, data.invoiceId, newAmount);
        await validateAllocations(tx, {
          userId: request.user.sub,
          organizationId: newOrgId,
          counterpartyId: newCpId ?? null,
          direction: newDirection,
          paymentAmount: newAmount,
          allocations: newAllocations,
          excludePaymentId: id,
        });
        await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
        if (newAllocations.length > 0) {
          await tx.paymentAllocation.createMany({
            data: newAllocations.map((a) => ({ paymentId: id, invoiceId: a.invoiceId, amount: a.amount })),
          });
        }
      } else {
        // Сумма изменилась, allocations не трогаем; синхронизируем legacy-случай (один allocation)
        if (data.amount !== undefined && existing.allocations.length === 1) {
          const alloc = existing.allocations[0]!;
          await tx.paymentAllocation.update({ where: { id: alloc.id }, data: { amount: data.amount } });
          // Re-валидация: не должны переплатить
          await validateAllocations(tx, {
            userId: existing.userId,
            organizationId: newOrgId,
            counterpartyId: newCpId ?? null,
            direction: newDirection,
            paymentAmount: newAmount,
            allocations: [{ invoiceId: alloc.invoiceId, amount: data.amount }],
            excludePaymentId: id,
          });
        }
        newAllocations = existing.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: Number(a.amount) }));
      }

      const allAffected = Array.from(new Set([...previousAffected, ...newAllocations.map((a) => a.invoiceId)]));
      for (const invId of allAffected) await recalcInvoiceStatus(tx, invId);
      return p;
    });

    return updated;
  });

  app.delete("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await prisma.payment.findFirst({
      where: { id },
      include: { allocations: true },
    });
    if (!existing) throw Errors.notFound("Платёж");
    await requireOrgAccess(prisma, request.user.sub, existing.organizationId, "payments:write");

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
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, organizationId: { in: orgIds } } });
    if (!invoice) throw Errors.notFound("Счёт");
    const allocations = await prisma.paymentAllocation.findMany({
      where: { invoiceId },
      include: { payment: { include: { counterparty: { select: { id: true, name: true } } } } },
      orderBy: { payment: { date: "asc" } },
    });
    const totalPaid = allocations.reduce((s, a) => s + Number(a.amount), 0);
    const total = Number(invoice.total);
    return {
      invoiceId,
      total: round2(total),
      paid: round2(totalPaid),
      balance: round2(Math.max(0, total - totalPaid)),
      allocations: allocations.map((a) => ({
        id: a.id,
        amount: Number(a.amount),
        paymentId: a.paymentId,
        payment: {
          id: a.payment.id,
          date: a.payment.date,
          amount: Number(a.payment.amount),
          method: a.payment.method,
          reference: a.payment.reference,
          purpose: a.payment.purpose,
          counterparty: a.payment.counterparty,
        },
      })),
    };
  });
}
