// Sprint 6A: Zod-схемы AI action plan.
// AI всегда возвращает строго один JSON-объект по этой схеме.
// Поддерживаются только два action.type: create_counterparty и create_invoice.
// Любые другие типы должны быть отклонены валидатором.

import { z } from "zod";

/* ---------- payload-схемы для каждого action ---------- */

const innSchema = z.string().regex(/^\d{10}$|^\d{12}$/, "ИНН: 10 (юрлицо) или 12 (ИП) цифр");

export const createCounterpartyPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1, "Краткое наименование обязательно").max(255),
  inn: innSchema,
  kpp: z.string().regex(/^\d{9}$/).optional().nullable(),
  legalAddress: z.string().max(500).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
});
export type CreateCounterpartyPayload = z.infer<typeof createCounterpartyPayloadSchema>;

/** vatRate допускает "no_vat" (без НДС) или один из дискретных процентов. */
export const vatRateSchema = z.union([
  z.literal("no_vat"),
  z.literal(0),
  z.literal(10),
  z.literal(20),
  z.literal(22),
]);
export type VatRateValue = z.infer<typeof vatRateSchema>;

export function vatRateToNumber(v: VatRateValue): number {
  return v === "no_vat" ? 0 : v;
}

export const invoiceItemPayloadSchema = z.object({
  name: z.string().min(1).max(500),
  unit: z.string().min(1).max(50).default("шт"),
  quantity: z.number().positive("Количество должно быть > 0"),
  price: z.number().min(0, "Цена не может быть отрицательной"),
  vatRate: vatRateSchema,
});
export type InvoiceItemPayload = z.infer<typeof invoiceItemPayloadSchema>;

export const createInvoicePayloadSchema = z.object({
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата ГГГГ-ММ-ДД"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  items: z.array(invoiceItemPayloadSchema).min(1, "Нужна хотя бы одна позиция"),
  note: z.string().max(2000).optional().nullable(),
});
export type CreateInvoicePayload = z.infer<typeof createInvoicePayloadSchema>;

/* ---------- Sprint 6B payloads ---------- */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата ГГГГ-ММ-ДД");

export const createActFromInvoicePayloadSchema = z.object({
  organizationId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  date: dateString.optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});
export type CreateActFromInvoicePayload = z.infer<typeof createActFromInvoicePayloadSchema>;

export const createContractPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  templateId: z.string().uuid().optional().nullable(),
  number: z.string().min(1).max(64).optional().nullable(),
  date: dateString.optional().nullable(),
  subject: z.string().min(1, "Предмет договора обязателен").max(2000),
  amount: z.number().min(0).optional().nullable(),
  validUntil: dateString.optional().nullable(),
  terms: z.string().max(5000).optional().nullable(),
});
export type CreateContractPayload = z.infer<typeof createContractPayloadSchema>;

export const analyzeDebtPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid().optional().nullable(),
  asOfDate: dateString.optional().nullable(),
});
export type AnalyzeDebtPayload = z.infer<typeof analyzeDebtPayloadSchema>;

/* ---------- Sprint 6C payloads ---------- */

export const paymentDirectionSchema = z.enum(["IN", "OUT"]);
export const paymentMethodSchema = z.enum(["BANK", "CASH", "CARD", "OTHER"]);

export const paymentAllocationPayloadSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().positive(),
});
export type PaymentAllocationPayload = z.infer<typeof paymentAllocationPayloadSchema>;

export const createPaymentPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  bankAccountId: z.string().uuid().optional().nullable(),
  date: dateString,
  amount: z.number().positive(),
  direction: paymentDirectionSchema,
  method: paymentMethodSchema.optional().default("BANK"),
  purpose: z.string().max(500).optional().nullable(),
  reference: z.string().max(100).optional().nullable(),
  allocations: z.array(paymentAllocationPayloadSchema).optional().nullable(),
});
export type CreatePaymentPayload = z.infer<typeof createPaymentPayloadSchema>;

export const suggestPaymentAllocationsPayloadSchema = z.object({
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  amount: z.number().positive(),
  asOfDate: dateString.optional().nullable(),
});
export type SuggestPaymentAllocationsPayload = z.infer<typeof suggestPaymentAllocationsPayloadSchema>;

/* ---------- payment suggestion result ---------- */

export interface PaymentSuggestionAllocation {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceBalance: number;
  suggestedAmount: number;
  reason: string;
}

export interface PaymentSuggestionResult {
  amount: number;
  allocatedAmount: number;
  advanceAmount: number;
  allocations: PaymentSuggestionAllocation[];
  warnings: string[];
  asOfDate: string;
}

/* ---------- analyze_debt result ---------- */

export interface DebtAnalysisCounterparty {
  counterpartyId: string;
  name: string;
  debt: number;
  overdueDebt: number;
  unpaidInvoicesCount: number;
  oldestOverdueDate: string | null;
}

export interface DebtAnalysisResult {
  totalDebt: number;
  overdueDebt: number;
  counterparties: DebtAnalysisCounterparty[];
  recommendations: string[];
  asOfDate: string;
}

/* ---------- action и план ---------- */

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1, "id action обязателен"),
    type: z.literal("create_counterparty"),
    payload: createCounterpartyPayloadSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("create_invoice"),
    payload: createInvoicePayloadSchema,
  }),
  // Sprint 6B
  z.object({
    id: z.string().min(1),
    type: z.literal("create_act_from_invoice"),
    payload: createActFromInvoicePayloadSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("create_contract"),
    payload: createContractPayloadSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("analyze_debt"),
    payload: analyzeDebtPayloadSchema,
  }),
  // Sprint 6C
  z.object({
    id: z.string().min(1),
    type: z.literal("create_payment"),
    payload: createPaymentPayloadSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("suggest_payment_allocations"),
    payload: suggestPaymentAllocationsPayloadSchema,
  }),
]);
export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action["type"];

export const ALLOWED_ACTION_TYPES: ActionType[] = [
  "create_counterparty",
  "create_invoice",
  "create_act_from_invoice",
  "create_contract",
  "analyze_debt",
  "create_payment",
  "suggest_payment_allocations",
];

/** Read-only actions — не создают бизнес-сущности, только возвращают данные. */
export const READ_ONLY_ACTION_TYPES: ActionType[] = ["analyze_debt", "suggest_payment_allocations"];

export function isReadOnlyAction(t: ActionType): boolean {
  return READ_ONLY_ACTION_TYPES.includes(t);
}

export const actionPlanSchema = z.object({
  intent: z.string().min(1).max(500),
  summary: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1).default(0.5),
  missingFields: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  actions: z.array(actionSchema).default([]),
});
export type ActionPlan = z.infer<typeof actionPlanSchema>;

export type TargetType = "counterparty" | "invoice" | "act" | "contract" | "analysis" | "payment";

/** Результат confirm — что применено, что пропущено, что упало. */
export interface AppliedAction {
  id: string;
  actionType: ActionType;
  targetType: TargetType;
  /** null для read-only actions (analyze_debt / suggest_payment_allocations). */
  targetId: string | null;
  /** Для read-only actions — фактический результат: анализ долгов или предложение распределения. */
  result?: DebtAnalysisResult | PaymentSuggestionResult;
}

export interface SkippedAction {
  id: string;
  actionType: ActionType;
  reason: string;
}

export interface FailedAction {
  id: string;
  actionType: ActionType;
  error: string;
}

export interface ConfirmResult {
  applied: AppliedAction[];
  skipped: SkippedAction[];
  errors: FailedAction[];
}
