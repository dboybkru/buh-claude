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

const EPS = 0.005;
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Нормализуем вход: если переданы allocations — используем их; иначе если есть invoiceId
 * (legacy одиночное распределение) — превращаем в один allocation на всю сумму платежа.
 * Дубли invoiceId в allocations сливаем в один с суммой = сумме.
 */
function normalizeAllocations(
  allocations: Array<{ invoiceId: string; amount: number }> | undefined,
  invoiceId: string | null | undefined,
  amount: number,
): Array<{ invoiceId: string; amount: number }> {
  let list: Array<{ invoiceId: string; amount: number }>;
  if (allocations && allocations.length > 0) list = allocations;
  else if (invoiceId) list = [{ invoiceId, amount }];
  else return [];

  // Слияние дублей
  const merged = new Map<string, number>();
  for (const a of list) merged.set(a.invoiceId, round2((merged.get(a.invoiceId) ?? 0) + a.amount));
  return Array.from(merged.entries()).map(([invoiceId, amount]) => ({ invoiceId, amount }));
}

/**
 * Проверка пакета аллокаций: все invoices существуют, принадлежат пользователю,
 * лежат в той же организации, том же контрагенте, не CANCELLED, не переплачиваются.
 * `excludePaymentId` — id текущего платежа (при PATCH/DELETE), его аллокации
 * не учитываем при подсчёте текущей оплаты.
 */
async function validateAllocations(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    organizationId: string;
    counterpartyId: string | null | undefined;
    direction: "IN" | "OUT";
    paymentAmount: number;
    allocations: Array<{ invoiceId: string; amount: number }>;
    excludePaymentId?: string;
  },
): Promise<void> {
  const { userId, organizationId, counterpartyId, direction, paymentAmount, allocations } = params;

  if (allocations.length === 0) return;

  if (direction === "OUT") {
    throw Errors.validation("Исходящий платёж (OUT) не может закрывать наши счета");
  }

  const allocSum = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (allocSum > paymentAmount + EPS) {
    throw Errors.validation(
      `Сумма распределения (${allocSum.toFixed(2)}) превышает сумму платежа (${paymentAmount.toFixed(2)})`,
    );
  }

  const ids = allocations.map((a) => a.invoiceId);
  const invoices = await tx.invoice.findMany({
    where: { id: { in: ids }, userId },
    select: {
      id: true,
      number: true,
      organizationId: true,
      counterpartyId: true,
      status: true,
      total: true,
      allocations: {
        where: params.excludePaymentId ? { paymentId: { not: params.excludePaymentId } } : {},
        select: { amount: true },
      },
    },
  });
  if (invoices.length !== ids.length) {
    throw Errors.validation("Один или несколько счетов не найдены");
  }

  for (const a of allocations) {
    const inv = invoices.find((i) => i.id === a.invoiceId);
    if (!inv) throw Errors.validation(`Счёт ${a.invoiceId} не найден`);
    if (inv.organizationId !== organizationId) {
      throw Errors.validation(`Счёт ${inv.number} принадлежит другой организации`);
    }
    if (counterpartyId != null && inv.counterpartyId !== counterpartyId) {
      throw Errors.validation(`Счёт ${inv.number} принадлежит другому контрагенту`);
    }
    if (inv.status === "CANCELLED") {
      throw Errors.validation(`Счёт ${inv.number} отменён, на него нельзя распределить платёж`);
    }
    const alreadyPaid = inv.allocations.reduce((s, x) => s + Number(x.amount), 0);
    const total = Number(inv.total);
    if (alreadyPaid + a.amount > total + EPS) {
      const balance = round2(total - alreadyPaid);
      throw Errors.validation(
        `Нельзя распределить ${a.amount.toFixed(2)} на счёт ${inv.number}: остаток ${balance.toFixed(2)}`,
      );
    }
  }
}

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
    const p = await prisma.payment.findFirst({
      where: { id, userId: request.user.sub },
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

    const org = await prisma.organization.findFirst({ where: { id: data.organizationId, userId } });
    if (!org) throw Errors.validation("Организация не найдена");
    if (data.counterpartyId) {
      const cp = await prisma.counterparty.findFirst({ where: { id: data.counterpartyId, userId } });
      if (!cp) throw Errors.validation("Контрагент не найден");
    }

    const allocations = normalizeAllocations(data.allocations, data.invoiceId, data.amount);

    const result = await prisma.$transaction(async (tx) => {
      await validateAllocations(tx, {
        userId,
        organizationId: data.organizationId,
        counterpartyId: data.counterpartyId ?? null,
        direction: data.direction,
        paymentAmount: data.amount,
        allocations,
      });

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

      if (allocations.length > 0) {
        await tx.paymentAllocation.createMany({
          data: allocations.map((a) => ({ paymentId: payment.id, invoiceId: a.invoiceId, amount: a.amount })),
        });
        for (const a of allocations) await recalcInvoiceStatus(tx, a.invoiceId);
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
            userId: request.user.sub,
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
