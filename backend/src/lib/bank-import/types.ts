// Типы модуля банковского импорта.
// Используются между parser.ts → normalizer.ts → matcher.ts → routes/bank-import.ts.

export interface RawBankRow {
  rowNumber: number;        // 1-based номер строки в файле (с учётом заголовка)
  raw: Record<string, string>;  // исходный объект «название колонки → значение»
}

export interface NormalizedBankRow {
  rowNumber: number;
  date: string | null;           // YYYY-MM-DD; null если не распарсилась
  amount: number | null;         // положительное; null если не распарсилась
  direction: "IN" | "OUT" | null;
  purpose: string | null;
  counterpartyName: string | null;
  counterpartyInn: string | null;
  reference: string | null;
  account: string | null;        // банковский счёт контрагента (если есть)
  raw: Record<string, string>;
  errors: string[];
  warnings: string[];
}

export interface SuggestedInvoiceAllocation {
  invoiceId: string;
  invoiceNumber: string;
  invoiceTotal: number;
  invoicePaid: number;
  invoiceBalance: number;
  suggestedAmount: number;
  confidence: number;            // 0..1
  reason: string;                // human-readable пояснение почему предложили
}

export type PreviewRowStatus = "ready" | "needs_review" | "error";

export interface PreviewRow extends NormalizedBankRow {
  suggestedCounterpartyId: string | null;
  suggestedInvoiceAllocations: SuggestedInvoiceAllocation[];
  status: PreviewRowStatus;
}

export interface PreviewSummary {
  totalRows: number;
  ready: number;
  needsReview: number;
  errors: number;
  totalIncome: number;
  totalExpense: number;
}

export interface PreviewPayload {
  importId: string;
  rows: PreviewRow[];
  summary: PreviewSummary;
}

export interface PreviewMeta {
  organizationId: string;
  bankAccountId: string | null;
  fileName: string;
  createdAt: number;             // ms epoch
  expiresAt: number;
}
