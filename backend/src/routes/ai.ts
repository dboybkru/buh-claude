// Sprint 6A: AI routes (полный flow).
//
// Endpoints:
//   GET    /api/v1/ai/settings                          — настройки (apiKey маскирован)
//   PUT    /api/v1/ai/settings                          — сохранить настройки
//   POST   /api/v1/ai/test                              — проверка соединения с провайдером
//   POST   /api/v1/ai/models                            — список доступных моделей
//   POST   /api/v1/ai/chat                              — собрать контекст, дёрнуть AI, сохранить DRAFT plan
//   POST   /api/v1/ai/action-plans/:id/confirm          — выполнить approved actions, записать audit log
//
// Принципы:
//   - apiKey НИКОГДА не возвращается во frontend в чистом виде;
//   - /chat не пишет бизнес-сущности — только создаёт ActionPlan со status DRAFT;
//   - /confirm проверяет владельца, status, не выполняет повторно;
//   - выполнение происходит через safe executor, кросс-orga запросы отклоняются.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/api-error.js";
import { encryptSecret, decryptSecret, maskSecret } from "../lib/crypto.js";

import { createProvider, type AiProviderConfig } from "../lib/ai/providers/index.js";
import { FULL_SYSTEM_PROMPT } from "../lib/ai/prompt.js";
import { loadAiContext, formatContextForPrompt, type AiContextScope } from "../lib/ai/context-loader.js";
import { parseActionPlan, selectApprovedActions } from "../lib/ai/action-plan.js";
import { executeAction, asFailedAction, toAppliedAction } from "../lib/ai/executor.js";
import type { ActionPlan, ConfirmResult, AppliedAction, FailedAction, SkippedAction } from "../lib/ai/schemas.js";

/* ---------- schemas ---------- */

const PROVIDER_KINDS = ["openai", "vsegpt", "aitunnel", "custom", "local", "mock"] as const;

const settingsSchema = z.object({
  provider: z.enum(PROVIDER_KINDS),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  temperature: z.coerce.number().min(0).max(2).default(0.2),
  maxTokens: z.coerce.number().int().min(100).max(32000).default(2000),
  isEnabled: z.boolean().default(true),
});

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  organizationId: z.string().uuid().optional().nullable(),
  scope: z.enum(["global", "organization"]).default("global"),
});

const confirmSchema = z.object({
  approvedActions: z.array(z.string()).optional(),
});

/* ---------- helpers ---------- */

interface LoadedAiConfig {
  provider: string;
  cfg: AiProviderConfig;
}

async function loadAiConfig(userId: string): Promise<LoadedAiConfig | null> {
  const s = await prisma.aiSettings.findUnique({ where: { userId } });
  if (!s || !s.enabled) return null;
  // Для mock-провайдера ключ не нужен, но в БД мы храним зашифрованную заглушку (mock-key)
  const apiKey = s.provider === "mock" ? "mock-key" : decryptSecret(s.apiKey);
  return {
    provider: s.provider,
    cfg: {
      apiKey,
      baseUrl: s.baseUrl,
      model: s.model,
      temperature: s.temperature,
      maxTokens: s.maxTokens,
    },
  };
}

/** API-форма настроек: apiKey маскирован, поле называется isEnabled. */
function serializeSettings(s: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  enabled: boolean;
  updatedAt: Date;
} | null) {
  if (!s) {
    return {
      provider: "openai",
      maskedApiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      temperature: 0.2,
      maxTokens: 2000,
      isEnabled: true,
      configured: false,
    };
  }
  const masked = s.provider === "mock" ? "(mock)" : maskSecret(decryptSecret(s.apiKey));
  return {
    provider: s.provider,
    maskedApiKey: masked,
    baseUrl: s.baseUrl,
    model: s.model,
    temperature: s.temperature,
    maxTokens: s.maxTokens,
    isEnabled: s.enabled,
    configured: true,
    updatedAt: s.updatedAt,
  };
}

/* ---------- route plugin ---------- */

export async function aiRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/settings", async (request) => {
    const s = await prisma.aiSettings.findUnique({ where: { userId: request.user.sub } });
    return serializeSettings(s);
  });

  app.put("/settings", async (request) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные настройки", parsed.error.flatten());
    const data = parsed.data;
    const existing = await prisma.aiSettings.findUnique({ where: { userId: request.user.sub } });

    // mock-провайдер хранит фиксированный плейсхолдер
    let apiKeyToStore: string;
    if (data.provider === "mock") {
      apiKeyToStore = encryptSecret("mock-key");
    } else {
      const apiKeyChanged = !!data.apiKey && !data.apiKey.includes("•");
      apiKeyToStore = apiKeyChanged
        ? encryptSecret(data.apiKey!)
        : existing?.apiKey ?? "";
      if (!apiKeyToStore) throw Errors.validation("Укажите API-ключ");
    }

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
        enabled: data.isEnabled,
      },
      update: {
        provider: data.provider,
        apiKey: apiKeyToStore,
        baseUrl: data.baseUrl,
        model: data.model,
        temperature: data.temperature,
        maxTokens: data.maxTokens,
        enabled: data.isEnabled,
      },
    });
    return serializeSettings(saved);
  });

  app.post("/test", async (request) => {
    const loaded = await loadAiConfig(request.user.sub);
    if (!loaded) throw Errors.validation("AI не настроен — откройте /ai/settings");
    const provider = createProvider(loaded.provider, loaded.cfg);
    try {
      const r = await provider.chat([
        { role: "system", content: "Reply with the single word: ok" },
        { role: "user", content: "ping" },
      ]);
      return { ok: true, reply: r.text.slice(0, 200) };
    } catch (err) {
      throw Errors.validation((err as Error).message);
    }
  });

  app.post("/models", async (request) => {
    const loaded = await loadAiConfig(request.user.sub);
    if (!loaded) throw Errors.validation("AI не настроен — откройте /ai/settings");
    const provider = createProvider(loaded.provider, loaded.cfg);
    try {
      return { models: await provider.listModels() };
    } catch (err) {
      throw Errors.validation((err as Error).message);
    }
  });

  /* -------------- chat: создать DRAFT action plan -------------- */
  app.post("/chat", async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные параметры", parsed.error.flatten());
    const { message, organizationId, scope } = parsed.data;
    const userId = request.user.sub;

    const loaded = await loadAiConfig(userId);
    if (!loaded) throw Errors.validation("AI не настроен — откройте /ai/settings");

    // 1. Контекст
    const context = await loadAiContext({ userId, organizationId: organizationId ?? null, scope: scope as AiContextScope });

    // 2. Если в контексте нет выбранного counterparty, но MockAIProvider парсит counterpartyId
    //    из system-prompt — добавим первого из списка контрагентов для удобства dev/test
    //    (это безопасно: всё равно executor проверит ownership).
    const promptContext = formatContextForPrompt(context);
    const cpHint = context.counterparties[0] ? `\nПодсказка для mock: counterpartyId="${context.counterparties[0].id}"` : "";

    const messages = [
      { role: "system" as const, content: FULL_SYSTEM_PROMPT },
      { role: "system" as const, content: promptContext + cpHint },
      { role: "user" as const, content: message },
    ];

    const provider = createProvider(loaded.provider, loaded.cfg);
    let raw: string;
    try {
      const r = await provider.chat(messages, { responseFormat: "json_object" });
      raw = r.text;
    } catch (err) {
      throw Errors.validation(`AI provider error: ${(err as Error).message}`);
    }

    // 3. Парсим план
    const parsedPlan = parseActionPlan(raw);
    if (!parsedPlan.ok || !parsedPlan.plan) {
      // Возвращаем 200 с описанием — фронт покажет ошибку и raw-output для дебага
      return reply.send({
        actionPlanId: null,
        error: parsedPlan.error,
        raw: parsedPlan.raw,
        actionPlan: null,
        warnings: [],
      });
    }
    const plan: ActionPlan = parsedPlan.plan;

    // 4. Сохраняем DRAFT
    const saved = await prisma.aiActionPlan.create({
      data: {
        userId,
        organizationId: organizationId ?? null,
        status: "DRAFT",
        message,
        planJson: plan as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
      },
    });

    return {
      actionPlanId: saved.id,
      message: plan.summary,
      actionPlan: plan,
      warnings: plan.warnings,
    };
  });

  /* -------------- confirm: применить approved actions -------------- */
  app.post("/action-plans/:id/confirm", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = confirmSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw Errors.validation("Невалидные параметры", parsed.error.flatten());
    const userId = request.user.sub;

    const planRow = await prisma.aiActionPlan.findFirst({ where: { id, userId } });
    if (!planRow) throw Errors.notFound("ActionPlan");
    if (planRow.status !== "DRAFT") {
      throw Errors.conflict(`ActionPlan уже в статусе ${planRow.status} — повторное применение запрещено`);
    }
    if (planRow.expiresAt && planRow.expiresAt < new Date()) {
      await prisma.aiActionPlan.update({ where: { id }, data: { status: "EXPIRED" } });
      throw Errors.conflict("Срок действия ActionPlan истёк");
    }

    const planJson = planRow.planJson as unknown;
    const validated = parseActionPlan(JSON.stringify(planJson));
    if (!validated.ok || !validated.plan) {
      await prisma.aiActionPlan.update({
        where: { id },
        data: { status: "FAILED", resultJson: { error: validated.error } as unknown as Prisma.InputJsonValue },
      });
      throw Errors.validation(`ActionPlan повреждён: ${validated.error ?? "?"}`);
    }

    const { approved, skipped: notApproved } = selectApprovedActions(validated.plan, parsed.data.approvedActions);

    const applied: AppliedAction[] = [];
    const errors: FailedAction[] = [];
    const skipped: SkippedAction[] = notApproved;

    for (const action of approved) {
      try {
        const res = await executeAction(userId, action);
        const ap = toAppliedAction(action, res);
        applied.push(ap);
        await prisma.aiAuditLog.create({
          data: {
            userId,
            organizationId: planRow.organizationId,
            actionPlanId: planRow.id,
            actionType: ap.actionType,
            targetType: ap.targetType,
            targetId: ap.targetId,
            payloadJson: action.payload as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        errors.push(asFailedAction(action, err));
      }
    }

    const result: ConfirmResult = { applied, skipped, errors };
    const finalStatus = errors.length > 0 && applied.length === 0 ? "FAILED" : "CONFIRMED";
    await prisma.aiActionPlan.update({
      where: { id },
      data: {
        status: finalStatus,
        confirmedAt: new Date(),
        resultJson: result as unknown as Prisma.InputJsonValue,
      },
    });

    return result;
  });
}
