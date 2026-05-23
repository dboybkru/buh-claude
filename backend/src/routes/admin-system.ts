// Sprint 10 — System Admin API. Mounted at /api/v1/admin/system.
//
// All endpoints require User.role=ADMIN (platform admin). Per-category PUT
// preserves existing secrets when omitted, masks them on GET, and writes a
// scrubbed SystemAuditLog entry on every change.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Errors } from "../lib/api-error.js";
import { requirePlatformAdmin } from "../lib/org-access.js";
import {
  loadSetting,
  saveSetting,
  serialiseSetting,
  writeAudit,
} from "../lib/system-settings.js";
import {
  testAi,
  testDadata,
  testSmtp,
} from "../lib/system-integrations.js";
import type { IntegrationCategory } from "@prisma/client";

const ALL_CATEGORIES: IntegrationCategory[] = ["DADATA", "AI", "SMTP", "APP"];

/* ---------- per-category PUT body schemas ---------- */

const dadataBody = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().url().optional(),
  suggestionsUrl: z.string().url().optional(),
  // Secrets — explicit. Omit to keep existing; "" to clear; non-empty to rotate.
  token: z.string().optional(),
  secret: z.string().optional(),
});

const aiBody = z.object({
  enabled: z.boolean().optional(),
  providerName: z.string().min(1).max(64).optional(),
  baseUrl: z.string().url().optional(),
  defaultModel: z.string().min(1).max(128).optional(),
  modelsEndpoint: z.string().url().optional().or(z.literal("")),
  timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  apiKey: z.string().optional(),
});

const smtpBody = z.object({
  enabled: z.boolean().optional(),
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().max(255).optional(),
  fromEmail: z.string().email().optional().or(z.literal("")),
  fromName: z.string().max(128).optional(),
  secure: z.boolean().optional(),
  requireTLS: z.boolean().optional(),
  password: z.string().optional(),
});

const appBody = z.object({
  enabled: z.boolean().optional(),
  publicUrl: z.string().url().optional().or(z.literal("")),
  supportEmail: z.string().email().optional().or(z.literal("")),
  appName: z.string().min(1).max(128).optional(),
});

const testSmtpBody = z.object({
  to: z.string().email(),
});

/* ---------- helpers ---------- */

function splitConfigAndSecrets(
  body: Record<string, unknown>,
  secretKeys: readonly string[],
): { config: Record<string, unknown>; secretDeltas: Record<string, string | undefined>; enabled?: boolean } {
  const config: Record<string, unknown> = {};
  const secretDeltas: Record<string, string | undefined> = {};
  let enabled: boolean | undefined;
  for (const [k, v] of Object.entries(body)) {
    if (k === "enabled" && typeof v === "boolean") {
      enabled = v;
      continue;
    }
    if (secretKeys.includes(k)) {
      if (v === undefined) continue;
      secretDeltas[k] = typeof v === "string" ? v : "";
    } else if (v !== undefined) {
      config[k] = v;
    }
  }
  return { config, secretDeltas, enabled };
}

const SECRET_KEYS: Record<IntegrationCategory, readonly string[]> = {
  DADATA: ["token", "secret"],
  AI: ["apiKey"],
  SMTP: ["password"],
  APP: [],
};

/* ---------- routes ---------- */

export async function adminSystemRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // GET all settings (one row per category, defaults if absent).
  app.get("/settings", async (request) => {
    await requirePlatformAdmin(request.user.sub);
    const items = await Promise.all(
      ALL_CATEGORIES.map(async (c) => serialiseSetting(await loadSetting(c))),
    );
    return { items };
  });

  // GET single category.
  app.get<{ Params: { category: string } }>("/settings/:category", async (request) => {
    await requirePlatformAdmin(request.user.sub);
    const cat = parseCategory(request.params.category);
    return serialiseSetting(await loadSetting(cat));
  });

  // PUT per-category.
  app.put("/settings/dadata", async (request) => {
    await requirePlatformAdmin(request.user.sub);
    const parsed = dadataBody.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные настройки DaData", parsed.error.flatten());
    return persist("DADATA", parsed.data, request.user.sub);
  });

  app.put("/settings/ai", async (request) => {
    await requirePlatformAdmin(request.user.sub);
    const parsed = aiBody.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные настройки AI", parsed.error.flatten());
    return persist("AI", parsed.data, request.user.sub);
  });

  app.put("/settings/smtp", async (request) => {
    await requirePlatformAdmin(request.user.sub);
    const parsed = smtpBody.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные настройки SMTP", parsed.error.flatten());
    return persist("SMTP", parsed.data, request.user.sub);
  });

  app.put("/settings/app", async (request) => {
    await requirePlatformAdmin(request.user.sub);
    const parsed = appBody.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные настройки App", parsed.error.flatten());
    return persist("APP", parsed.data, request.user.sub);
  });

  // Test endpoints — never throw, always return { ok, message? }.
  app.post("/test/dadata", async (request) => {
    await requirePlatformAdmin(request.user.sub);
    const result = await testDadata();
    await writeAudit({
      actorUserId: request.user.sub,
      action: "SYSTEM_SETTING_TESTED",
      category: "DADATA",
      metadata: { ok: result.ok, message: result.message ?? null },
    });
    return result;
  });

  app.post("/test/ai", async (request) => {
    await requirePlatformAdmin(request.user.sub);
    const result = await testAi();
    await writeAudit({
      actorUserId: request.user.sub,
      action: "SYSTEM_SETTING_TESTED",
      category: "AI",
      metadata: { ok: result.ok, message: result.message ?? null },
    });
    return result;
  });

  app.post("/test/smtp", async (request) => {
    await requirePlatformAdmin(request.user.sub);
    const parsed = testSmtpBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw Errors.validation("Укажите test email", parsed.error.flatten());
    }
    const result = await testSmtp(parsed.data.to);
    await writeAudit({
      actorUserId: request.user.sub,
      action: "SYSTEM_SETTING_TESTED",
      category: "SMTP",
      metadata: { ok: result.ok, message: result.message ?? null, to: parsed.data.to },
    });
    return result;
  });
}

/* ---------- private ---------- */

async function persist(
  category: IntegrationCategory,
  body: Record<string, unknown>,
  actorUserId: string,
) {
  const split = splitConfigAndSecrets(body, SECRET_KEYS[category]);
  const result = await saveSetting({
    category,
    config: split.config,
    secretDeltas: split.secretDeltas,
    enabled: split.enabled,
    actorUserId,
  });

  await writeAudit({
    actorUserId,
    action: result.rotatedSecretKeys.length > 0 ? "SECRET_ROTATED" : "SYSTEM_SETTING_UPDATED",
    category,
    metadata: {
      changedConfigFields: result.changedConfigFields,
      rotatedSecretKeys: result.rotatedSecretKeys, // names only, not values
      enabled: result.setting.enabled,
    },
  });

  return serialiseSetting(result.setting);
}

function parseCategory(s: string): IntegrationCategory {
  const upper = s.toUpperCase() as IntegrationCategory;
  if (!ALL_CATEGORIES.includes(upper)) {
    throw Errors.validation(`Неизвестная категория: ${s}`);
  }
  return upper;
}
