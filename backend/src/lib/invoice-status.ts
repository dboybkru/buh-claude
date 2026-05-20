// Пересчёт статуса счёта на основании суммы платежей.
// Вызывается после любого CRUD-действия с Payment / PaymentAllocation.

import { Prisma } from "@prisma/client";

/**
 * Пересчитывает paidAt и статус счёта по сумме allocations.
 * Не трогает счета в "терминальных" статусах CANCELLED.
 * DRAFT/SENT/OVERDUE/PARTIALLY_PAID/PAID могут переключаться автоматически.
 */
export async function recalcInvoiceStatus(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true, total: true, dueDate: true, allocations: { select: { amount: true } } },
  });
  if (!invoice) return;
  if (invoice.status === "CANCELLED") return;

  const total = Number(invoice.total);
  const paid = invoice.allocations.reduce((s, a) => s + Number(a.amount), 0);
  const epsilon = 0.005;

  let nextStatus: typeof invoice.status = invoice.status;
  let paidAt: Date | null = null;

  if (paid >= total - epsilon) {
    nextStatus = "PAID";
    // paidAt — дата последнего платежа (берём max(date))
    const last = await tx.payment.findFirst({
      where: { allocations: { some: { invoiceId } } },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    paidAt = last?.date ?? new Date();
  } else if (paid > epsilon) {
    nextStatus = "PARTIALLY_PAID";
  } else {
    // Нет оплат — DRAFT/SENT/OVERDUE
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = invoice.dueDate ? new Date(invoice.dueDate) < today : false;
    if (overdue) nextStatus = "OVERDUE";
    else if (invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID") {
      // Откатились с оплаты — вернём в DRAFT
      nextStatus = "DRAFT";
    }
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { status: nextStatus, paidAt },
  });
}
