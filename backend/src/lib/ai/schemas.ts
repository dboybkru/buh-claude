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
]);
export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action["type"];

export const ALLOWED_ACTION_TYPES: ActionType[] = ["create_counterparty", "create_invoice"];

export const actionPlanSchema = z.object({
  intent: z.string().min(1).max(500),
  summary: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1).default(0.5),
  missingFields: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  actions: z.array(actionSchema).default([]),
});
export type ActionPlan = z.infer<typeof actionPlanSchema>;

/** Результат confirm — что применено, что пропущено, что упало. */
export interface AppliedAction {
  id: string;
  actionType: ActionType;
  targetType: "counterparty" | "invoice";
  targetId: string;
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
