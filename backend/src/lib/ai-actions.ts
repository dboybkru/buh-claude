// AI-actions: ответы от модели типизируются как structured JSON. UI показывает
// preview и пользователь подтверждает применение. Backend применяет действие
// в одной транзакции под userId.

import { z } from "zod";

export const aiActionSchema = z.discriminatedUnion("type", [
  // Создать счёт
  z.object({
    type: z.literal("create_invoice"),
    payload: z.object({
      organizationId: z.string().uuid().optional(),
      counterpartyId: z.string().uuid().optional(),
      counterpartyInn: z.string().regex(/^\d{10}(\d{2})?$/).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      paymentPurpose: z.string().optional(),
      vatRate: z.number().min(0).max(99.99).default(22),
      vatIncluded: z.boolean().default(true),
      items: z.array(z.object({
        name: z.string().min(1),
        unit: z.string().default("шт"),
        quantity: z.number().positive(),
        price: z.number().min(0),
        vatRate: z.number().min(0).max(99.99).default(22),
      })).min(1),
    }),
    missingFields: z.array(z.string()).default([]),
  }),
  // Просто текстовый ответ (вопрос-ответ без действий)
  z.object({
    type: z.literal("answer"),
    payload: z.object({ text: z.string() }),
    missingFields: z.array(z.string()).default([]),
  }),
  // Поиск просроченных счетов — выполнится backend-ом, вернёт результат
  z.object({
    type: z.literal("find_overdue_invoices"),
    payload: z.object({}).default({}),
    missingFields: z.array(z.string()).default([]),
  }),
]);

export type AiAction = z.infer<typeof aiActionSchema>;

export const SYSTEM_PROMPT = `Ты — бухгалтерский ассистент для российской системы документооборота BuhClaude.

Всегда отвечай СТРОГО валидным JSON-объектом без markdown-обёртки и комментариев.
Формат ответа — один из:

1) {"type":"answer","payload":{"text":"..."},"missingFields":[]}
   — если вопрос информационный, не требует создания документов.

2) {"type":"create_invoice","payload":{"organizationId":"uuid?","counterpartyId":"uuid?","counterpartyInn":"...?","dueDate":"YYYY-MM-DD?","paymentPurpose":"...","vatRate":22,"vatIncluded":true,"items":[{"name":"...","unit":"шт","quantity":1,"price":1000,"vatRate":22}]},"missingFields":["..."]}
   — если пользователь просит создать счёт.

3) {"type":"find_overdue_invoices","payload":{},"missingFields":[]}
   — найти все просроченные счета пользователя.

Правила:
- Если пользователь не указал организацию или контрагента — НЕ выдумывай UUID и ИНН; ставь null/опускай поля и перечисляй в missingFields ("organizationId", "counterpartyId").
- Базовая ставка НДС с 01.01.2026 — 22% (НК РФ ст. 164). Для УСН возможны 5% или 7%.
- Все суммы — числа (не строки), копейки через точку. Декимальная точность до 2 знаков.
- Никогда не возвращай SQL, код или markdown — только один JSON-объект.
- Если запрос непонятен — ответь "answer" с текстом-уточнением.`;
