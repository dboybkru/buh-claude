import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/api-error.js";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.js";
import { chatCompletion, listModels, type AiConfig } from "../lib/ai-client.js";
import { aiActionSchema, SYSTEM_PROMPT, type AiAction } from "../lib/ai-actions.js";

const settingsSchema = z.object({
  provider: z.string().min(1).max(50),
  apiKey: z.string().min(1).optional(),   // optional — при PUT можно не менять
  baseUrl: z.string().url(),
  model: z.string().min(1),
  temperature: z.coerce.number().min(0).max(2).default(0.2),
  maxTokens: z.coerce.number().int().min(100).max(32000).default(2000),
  enabled: z.boolean().default(true),
});

async function loadConfig(userId: string): Promise<AiConfig | null> {
  const s = await prisma.aiSettings.findUnique({ where: { userId } });
  if (!s || !s.enabled) return null;
  return {
    apiKey: decryptSecret(s.apiKey),
    baseUrl: s.baseUrl,
    model: s.model,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
  };
}

export async function aiRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // Получить настройки (apiKey маскируется)
  app.get("/settings", async (request) => {
    const s = await prisma.aiSettings.findUnique({ where: { userId: request.user.sub } });
    if (!s) {
      return {
        provider: "openai",
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        temperature: 0.2,
        maxTokens: 2000,
        enabled: true,
        configured: false,
      };
    }
    return {
      provider: s.provider,
      apiKey: maskSecret(decryptSecret(s.apiKey)),
      baseUrl: s.baseUrl,
      model: s.model,
      temperature: s.temperature,
      maxTokens: s.maxTokens,
      enabled: s.enabled,
      configured: true,
      updatedAt: s.updatedAt,
    };
  });

  // Сохранить настройки (upsert). Если apiKey не передан или maskSecret вида "abc•••xyz" — оставляем старый.
  app.put("/settings", async (request) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные настройки", parsed.error.flatten());
    const data = parsed.data;
    const existing = await prisma.aiSettings.findUnique({ where: { userId: request.user.sub } });

    const apiKeyChanged = !!data.apiKey && !data.apiKey.includes("•");
    const apiKeyToStore = apiKeyChanged
      ? encryptSecret(data.apiKey!)
      : existing?.apiKey ?? null;

    if (!apiKeyToStore) throw Errors.validation("Укажите API-ключ");

    const saved = await prisma.aiSettings.upsert({
      where: { userId: request.user.sub },
      create: {
        userId: request.user.sub,
        provider: data.provider,
        apiKey: apiKeyToStore,
        baseUrl: data.baseUrl,
        model: data.model,
        temperature: data.temperature,
        maxTokens: data.maxTokens,
        enabled: data.enabled,
      },
      update: {
        provider: data.provider,
        apiKey: apiKeyToStore,
        baseUrl: data.baseUrl,
        model: data.model,
        temperature: data.temperature,
        maxTokens: data.maxTokens,
        enabled: data.enabled,
      },
    });
    return { ok: true, updatedAt: saved.updatedAt };
  });

  // Тест соединения: краткий запрос модели
  app.post("/test", async (request) => {
    const cfg = await loadConfig(request.user.sub);
    if (!cfg) throw Errors.validation("Сначала сохраните настройки и включите AI");
    try {
      const r = await chatCompletion(cfg, [
        { role: "system", content: "Reply with the single word: ok" },
        { role: "user", content: "ping" },
      ]);
      return { ok: true, reply: r.text.slice(0, 200), usage: r.raw.usage };
    } catch (err) {
      throw Errors.validation((err as Error).message);
    }
  });

  // Список доступных моделей
  app.get("/models", async (request) => {
    const cfg = await loadConfig(request.user.sub);
    if (!cfg) throw Errors.validation("Сначала сохраните настройки и включите AI");
    try {
      const ids = await listModels(cfg);
      return { models: ids };
    } catch (err) {
      throw Errors.validation((err as Error).message);
    }
  });

  // Основная ручка для AI-ассистента: возвращает structured JSON action.
  app.post("/chat", async (request) => {
    const body = z.object({
      message: z.string().min(1).max(4000),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(20).default([]),
    }).parse(request.body);

    const cfg = await loadConfig(request.user.sub);
    if (!cfg) throw Errors.validation("AI не настроен. Откройте раздел AI → Настройки.");

    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      ...body.history,
      { role: "user" as const, content: body.message },
    ];

    let r;
    try {
      r = await chatCompletion(cfg, messages, { responseFormat: "json_object" });
    } catch (err) {
      throw Errors.validation((err as Error).message);
    }

    // Парсим как JSON. Если модель вернула невалидно — возвращаем ошибку с raw.
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(r.text);
    } catch {
      return { action: { type: "answer" as const, payload: { text: r.text }, missingFields: [] }, raw: r.text };
    }

    const action = aiActionSchema.safeParse(parsedJson);
    if (!action.success) {
      // Если структура не та — оборачиваем как "answer"
      return {
        action: { type: "answer" as const, payload: { text: r.text }, missingFields: [] },
        raw: r.text,
        parseError: action.error.flatten(),
      };
    }
    return { action: action.data, raw: r.text, usage: r.raw.usage };
  });

  // Применить action (с подтверждением). MVP: пока только find_overdue_invoices
  // и create_invoice (если все поля заполнены).
  app.post("/apply", async (request) => {
    const body = z.object({ action: aiActionSchema }).parse(request.body);
    const userId = request.user.sub;
    return applyAction(userId, body.action);
  });
}

async function applyAction(userId: string, action: AiAction): Promise<unknown> {
  switch (action.type) {
    case "answer":
      return { ok: true, result: { text: action.payload.text } };

    case "find_overdue_invoices": {
      const today = new Date();
      const overdue = await prisma.invoice.findMany({
        where: {
          userId,
          status: { in: ["DRAFT", "SENT", "PARTIALLY_PAID", "OVERDUE"] },
          dueDate: { lt: today },
        },
        orderBy: { dueDate: "asc" },
        include: { counterparty: { select: { name: true, inn: true } } },
      });
      return {
        ok: true,
        result: {
          count: overdue.length,
          invoices: overdue.map((i) => ({
            id: i.id,
            number: i.number,
            dueDate: i.dueDate,
            total: Number(i.total),
            counterparty: i.counterparty.name,
            inn: i.counterparty.inn,
            status: i.status,
          })),
        },
      };
    }

    case "create_invoice": {
      const p = action.payload;
      // missingFields контракт: фронт ДОЛЖЕН был дозаполнить organizationId/counterpartyId перед apply
      if (!p.organizationId) throw Errors.validation("Не указана организация");
      let counterpartyId = p.counterpartyId;
      if (!counterpartyId && p.counterpartyInn) {
        const cp = await prisma.counterparty.findFirst({ where: { userId, inn: p.counterpartyInn } });
        if (cp) counterpartyId = cp.id;
      }
      if (!counterpartyId) throw Errors.validation("Не указан контрагент (id или ИНН)");

      // Простой пересчёт сумм (та же логика, что recalcAll на фронте)
      const items = p.items.map((it, idx) => {
        const qty = it.quantity, price = it.price, rate = it.vatRate;
        let subtotal: number, vat: number, total: number;
        if (p.vatIncluded) {
          total = round2(qty * price);
          vat = rate === 0 ? 0 : round2((total * rate) / (100 + rate));
          subtotal = round2(total - vat);
        } else {
          subtotal = round2(qty * price);
          vat = rate === 0 ? 0 : round2((subtotal * rate) / 100);
          total = round2(subtotal + vat);
        }
        return { ...it, sortOrder: idx + 1, subtotal, vatAmount: vat, total };
      });
      const docSubtotal = round2(items.reduce((s, x) => s + x.subtotal, 0));
      const docVat = round2(items.reduce((s, x) => s + x.vatAmount, 0));
      const docTotal = round2(items.reduce((s, x) => s + x.total, 0));

      const year = new Date().getFullYear();
      const result = await prisma.$transaction(async (tx) => {
        const counter = await tx.documentNumbering.upsert({
          where: { userId_organizationId_docType_year: { userId, organizationId: p.organizationId!, docType: "INVOICE", year } },
          create: { userId, organizationId: p.organizationId!, docType: "INVOICE", year, lastNumber: 1, prefix: "СЧ-" },
          update: { lastNumber: { increment: 1 } },
        });
        const number = `${counter.prefix}${String(counter.lastNumber).padStart(4, "0")}/${year}`;
        const inv = await tx.invoice.create({
          data: {
            userId,
            organizationId: p.organizationId!,
            counterpartyId: counterpartyId!,
            number,
            date: new Date(),
            dueDate: p.dueDate ? new Date(p.dueDate) : null,
            vatRate: p.vatRate,
            vatIncluded: p.vatIncluded,
            subtotal: docSubtotal,
            vatAmount: docVat,
            total: docTotal,
            paymentPurpose: p.paymentPurpose ?? null,
          },
        });
        await tx.documentItem.createMany({
          data: items.map((it) => ({
            userId,
            documentType: "INVOICE" as const,
            invoiceId: inv.id,
            sortOrder: it.sortOrder,
            name: it.name,
            unit: it.unit,
            unitCode: "796",
            quantity: it.quantity,
            price: it.price,
            vatRate: it.vatRate,
            subtotal: it.subtotal,
            vatAmount: it.vatAmount,
            total: it.total,
          })),
        });
        return inv;
      });
      return { ok: true, result: { id: result.id, number: result.number, total: Number(result.total) } };
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
