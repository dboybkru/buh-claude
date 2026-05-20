import type { DocStatus, InvoiceStatus } from "@prisma/client";

// Статусы документа, после которых редактирование запрещено (402-ФЗ —
// подписанный документ нельзя править, только создавать исправление).
const LOCKED_DOC_STATUSES: DocStatus[] = ["ACCEPTED", "SIGNED", "PAID", "CANCELLED"];
const LOCKED_INVOICE_STATUSES: InvoiceStatus[] = ["PAID", "CANCELLED"];

export function isDocStatusLocked(s: DocStatus): boolean {
  return LOCKED_DOC_STATUSES.includes(s);
}

export function isInvoiceStatusLocked(s: InvoiceStatus): boolean {
  return LOCKED_INVOICE_STATUSES.includes(s);
}

export class DocumentLockedError extends Error {
  constructor(public readonly status: string) {
    super(`Документ в статусе ${status} нельзя редактировать. Создайте исправление.`);
    this.name = "DocumentLockedError";
  }
}
