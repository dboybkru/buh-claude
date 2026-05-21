// Сервис создания/валидации платежей с распределением.
// Используется в routes/payments.ts и routes/bank-import.ts — единая точка
// бизнес-логики, чтобы избежать копипасты и дрейфа правил.

import { Prisma } from "@prisma/client";
import { Errors } from "./api-error.js";
import { recalcInvoiceStatus } from "./invoice-status.js";

export interface AllocationInput {
  invoiceId: string;
  amount: number;
}

export interface CreatePaymentInput {
  organizationId: string;
  counterpartyId?: string | null;
  bankAccountId?: string | null;
  date: string;                       // YYYY-MM-DD
  amount: number;
  direction: "IN" | "OUT";
  method: "BANK" | "CASH" | "CARD" | "OTHER";
  purpose?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** Если переданы — будут созданы PaymentAllocation. */
  allocations?: AllocationInput[];
  /** Legacy: одиночный счёт. Если allocations не переданы — оборачивается в один allocation на всю сумму. */
  invoiceId?: string | null;
}

const EPS = 0.005;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Нормализуем вход: allocations имеют приоритет; legacy invoiceId → 1 allocation.
 * Дубли invoiceId сливаются в один.
 */
export function normalizeAllocations(
  allocations: AllocationInput[] | undefined,
  invoiceId: string | null | undefined,
  amount: number,
): AllocationInput[] {
  let list: AllocationInput[];
  if (allocations && allocations.length > 0) list = allocations;
  else if (invoiceId) list = [{ invoiceId, amount }];
  else return [];

  const merged = new Map<string, number>();
  for (const a of list) merged.set(a.invoiceId, round2((merged.get(a.invoiceId) ?? 0) + a.amount));
  return Array.from(merged.entries()).map(([invoiceId, amount]) => ({ invoiceId, amount }));
}

/**
 * Проверка пакета аллокаций.
 * - все invoices существуют и принадлежат пользователю;
 * - все в той же организации;
 * - все того же контрагента (если контрагент задан);
 * - ни один не CANCELLED;
 * - суммарно не превышают amount платежа;
 * - не переплачиваем счёт с учётом уже существующих оплат.
 * `excludePaymentId` — для PATCH/DELETE: не учитываем аллокации текущего платежа в подсчёте current paid.
 */
export async function validateAllocations(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    organizationId: string;
    counterpartyId: string | null | undefined;
    direction: "IN" | "OUT";
    paymentAmount: number;
    allocations: AllocationInput[];
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
      id: true, number: true, organizationId: true, counterpartyId: true,
      status: true, total: true,
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
 * Атомарно создаёт Payment + (опционально) PaymentAllocation, пересчитывает статусы счетов.
 * Бросает ApiError при ошибке. Возвращает созданный Payment.
 */
export async function createPaymentInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  data: CreatePaymentInput,
): Promise<{ id: string }> {
  // Проверки на принадлежность сущностей юзеру
  const org = await tx.organization.findFirst({ where: { id: data.organizationId, userId }, select: { id: true } });
  if (!org) throw Errors.validation("Организация не найдена");
  if (data.counterpartyId) {
    const cp = await tx.counterparty.findFirst({ where: { id: data.counterpartyId, userId }, select: { id: true } });
    if (!cp) throw Errors.validation("Контрагент не найден");
  }
  if (data.bankAccountId) {
    const ba = await tx.bankAccount.findFirst({
      where: { id: data.bankAccountId, organizationId: data.organizationId },
      select: { id: true },
    });
    if (!ba) throw Errors.validation("Банковский счёт не найден или принадлежит другой организации");
  }

  const allocations = normalizeAllocations(data.allocations, data.invoiceId, data.amount);

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

  return { id: payment.id };
}
