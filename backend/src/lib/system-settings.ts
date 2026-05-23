// Sprint 10 — System settings service.
//
// Single source of truth for reading/writing IntegrationSetting rows.
// Routes go through getSettings() / saveSettings() / testSettings() — never
// touch prisma.integrationSetting directly. This keeps the secret-encryption
// path centralised and makes the audit log mandatory rather than opt-in.

import type { IntegrationCategory, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  decryptSecretBundle,
  encryptSecretBundle,
  maskSecret,
} from "./secrets.js";

/* ---------- typed config + secret shapes per category ---------- */

export interface DadataConfig {
  enabled: boolean;
  baseUrl?: string;
  suggestionsUrl?: string;
}

export interface DadataSecrets {
  token: string;
  secret: string;
}

export interface AiConfig {
  enabled: boolean;
  providerName: string;
  baseUrl: string;
  defaultModel: string;
  modelsEndpoint?: string;
  timeoutMs: number;
}

export interface AiSecrets {
  apiKey: string;
}

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  fromEmail: string;
  fromName: string;
  secure: boolean;
  requireTLS: boolean;
}

export interface SmtpSecrets {
  password: string;
}

export interface AppConfig {
  enabled: boolean;
  publicUrl: string;
  supportEmail: string;
  appName: string;
}

export type AppSecrets = Record<string, never>;

/* ---------- canonical empty/default rows ---------- */

const DEFAULTS: Record<IntegrationCategory, { config: Record<string, unknown>; secretKeys: readonly string[] }> = {
  DADATA: {
    config: { enabled: false, baseUrl: "https://suggestions.dadata.ru/suggestions/api/4_1/rs" },
    secretKeys: ["token", "secret"],
  },
  AI: {
    config: {
      enabled: false,
      providerName: "openai",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini",
      timeoutMs: 60_000,
    },
    secretKeys: ["apiKey"],
  },
  SMTP: {
    config: {
      enabled: false,
      host: "",
      port: 587,
      username: "",
      fromEmail: "",
      fromName: "BuhClaude",
      secure: false,
      requireTLS: true,
    },
    secretKeys: ["password"],
  },
  APP: {
    config: { enabled: true, publicUrl: "", supportEmail: "", appName: "BuhClaude" },
    secretKeys: [],
  },
};

/** Serialised shape returned by API. No raw secrets. */
export interface SerialisedSetting {
  category: IntegrationCategory;
  enabled: boolean;
  config: Record<string, unknown>;
  secretPresent: Record<string, boolean>;
  secretMasked: Record<string, string>;
  updatedById: string | null;
  updatedAt: string | null;
}

/* ---------- internal loaders ---------- */

interface LoadedSetting {
  category: IntegrationCategory;
  enabled: boolean;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  updatedById: string | null;
  updatedAt: Date | null;
}

/**
 * Loads the raw setting + decrypts its secret bundle. Returns DEFAULTS when
 * the row doesn't exist yet — callers always get a usable shape.
 */
export async function loadSetting(category: IntegrationCategory): Promise<LoadedSetting> {
  const row = await prisma.integrationSetting.findUnique({ where: { category } });
  if (!row) {
    return {
      category,
      enabled: false,
      config: { ...DEFAULTS[category].config },
      secrets: {},
      updatedById: null,
      updatedAt: null,
    };
  }
  const merged = { ...DEFAULTS[category].config, ...(row.configJson as Record<string, unknown>) };
  // Ensure the `enabled` mirror on row stays authoritative.
  merged.enabled = row.enabled;
  return {
    category,
    enabled: row.enabled,
    config: merged,
    secrets: decryptSecretBundle(row.secretsCiphertext),
    updatedById: row.updatedById,
    updatedAt: row.updatedAt,
  };
}

/** Public, masked serialisation. Never includes raw secret values. */
export function serialiseSetting(loaded: LoadedSetting): SerialisedSetting {
  const secretKeys = DEFAULTS[loaded.category].secretKeys;
  const secretPresent: Record<string, boolean> = {};
  const secretMasked: Record<string, string> = {};
  for (const k of secretKeys) {
    const v = loaded.secrets[k] ?? "";
    secretPresent[k] = v.length > 0;
    secretMasked[k] = maskSecret(v);
  }
  return {
    category: loaded.category,
    enabled: loaded.enabled,
    config: { ...loaded.config, enabled: loaded.enabled },
    secretPresent,
    secretMasked,
    updatedById: loaded.updatedById,
    updatedAt: loaded.updatedAt ? loaded.updatedAt.toISOString() : null,
  };
}

/* ---------- save / patch ---------- */

interface SaveInput {
  category: IntegrationCategory;
  config: Record<string, unknown>;
  /**
   * Secret deltas. Each value:
   *   - `undefined` or missing key → keep existing
   *   - empty string → clear this secret
   *   - non-empty string → replace
   */
  secretDeltas?: Record<string, string | undefined>;
  enabled?: boolean;
  actorUserId: string;
}

export interface SaveResult {
  setting: LoadedSetting;
  changedConfigFields: string[];
  rotatedSecretKeys: string[];
}

export async function saveSetting(input: SaveInput): Promise<SaveResult> {
  const existing = await loadSetting(input.category);
  const allowedSecretKeys = DEFAULTS[input.category].secretKeys;

  // Merge secrets. existing.secrets is the prior bundle.
  const nextSecrets: Record<string, string> = { ...existing.secrets };
  const rotated: string[] = [];
  if (input.secretDeltas) {
    for (const k of allowedSecretKeys) {
      if (!(k in input.secretDeltas)) continue;
      const v = input.secretDeltas[k];
      if (v === undefined) continue; // explicit undefined also = keep
      if (v.length === 0) {
        if ((nextSecrets[k] ?? "") !== "") rotated.push(k);
        delete nextSecrets[k];
      } else if (v !== nextSecrets[k]) {
        nextSecrets[k] = v;
        rotated.push(k);
      }
    }
  }
  const ciphertext = encryptSecretBundle(nextSecrets);

  // Compute config diff against existing.config (after defaults). Strip
  // `enabled` from `config` since it lives on its own row column.
  const mergedConfig: Record<string, unknown> = { ...existing.config, ...input.config };
  delete mergedConfig.enabled;
  const changedConfigFields = diffConfigKeys(stripEnabled(existing.config), mergedConfig);

  const enabled = input.enabled ?? existing.enabled;

  const upserted = await prisma.integrationSetting.upsert({
    where: { category: input.category },
    update: {
      enabled,
      configJson: mergedConfig as Prisma.InputJsonValue,
      secretsCiphertext: ciphertext,
      updatedById: input.actorUserId,
    },
    create: {
      category: input.category,
      enabled,
      configJson: mergedConfig as Prisma.InputJsonValue,
      secretsCiphertext: ciphertext,
      updatedById: input.actorUserId,
    },
  });

  return {
    setting: {
      category: upserted.category,
      enabled: upserted.enabled,
      config: { ...DEFAULTS[input.category].config, ...(upserted.configJson as Record<string, unknown>), enabled: upserted.enabled },
      secrets: nextSecrets,
      updatedById: upserted.updatedById,
      updatedAt: upserted.updatedAt,
    },
    changedConfigFields,
    rotatedSecretKeys: rotated,
  };
}

function stripEnabled(o: Record<string, unknown>): Record<string, unknown> {
  const c = { ...o };
  delete c.enabled;
  return c;
}

function diffConfigKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  }
  return out.sort();
}

/* ---------- audit ---------- */

export async function writeAudit(input: {
  actorUserId: string;
  action: "SYSTEM_SETTING_UPDATED" | "SYSTEM_SETTING_TESTED" | "SECRET_ROTATED";
  category: IntegrationCategory;
  metadata: Record<string, unknown>;
}): Promise<void> {
  // Defensive: scrub anything that looks like a secret before writing.
  const safe = scrubSecretLikeKeys(input.metadata);
  await prisma.systemAuditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      category: input.category,
      metadataJson: safe as Prisma.InputJsonValue,
    },
  });
}

const SECRET_LIKE = /(token|secret|password|apikey|api_key|key)$/i;

function scrubSecretLikeKeys(o: unknown): unknown {
  if (o === null || typeof o !== "object") return o;
  if (Array.isArray(o)) return o.map(scrubSecretLikeKeys);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === "string" && SECRET_LIKE.test(k)) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = scrubSecretLikeKeys(v);
    }
  }
  return out;
}
