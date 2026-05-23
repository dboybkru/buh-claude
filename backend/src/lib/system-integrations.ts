// Sprint 10 — runtime helpers that read IntegrationSetting and use the
// configured integrations. Routes hit these via POST /admin/system/test/*.
//
// DaData / AI / SMTP all return a structured TestResult { ok, message?, details? }
// — failures never throw, they return ok=false with an operator-friendly
// message. Outbound timeouts default to 10s.

import nodemailer from "nodemailer";
import { request } from "undici";
import { loadSetting } from "./system-settings.js";
import type { DadataSecrets, AiSecrets, SmtpSecrets, SmtpConfig, AiConfig, DadataConfig } from "./system-settings.js";

export interface TestResult {
  ok: boolean;
  message?: string;
  details?: unknown;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/* ---------- DaData test: lightweight party suggest ---------- */

export async function testDadata(): Promise<TestResult> {
  const s = await loadSetting("DADATA");
  if (!s.enabled) return { ok: false, message: "DaData отключена в настройках" };
  const cfg = s.config as unknown as DadataConfig;
  const secrets = s.secrets as unknown as DadataSecrets;
  if (!secrets.token) return { ok: false, message: "Не задан DaData token" };

  const baseUrl = cfg.suggestionsUrl ?? cfg.baseUrl ?? "https://suggestions.dadata.ru/suggestions/api/4_1/rs";
  const url = `${baseUrl.replace(/\/$/, "")}/suggest/party`;
  try {
    const { statusCode, body } = await request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Token ${secrets.token}`,
      },
      body: JSON.stringify({ query: "Сбербанк", count: 1 }),
      bodyTimeout: DEFAULT_TIMEOUT_MS,
      headersTimeout: DEFAULT_TIMEOUT_MS,
    });
    const text = await body.text();
    if (statusCode === 200) {
      let suggestionsCount = 0;
      try {
        const parsed = JSON.parse(text) as { suggestions?: unknown[] };
        suggestionsCount = parsed.suggestions?.length ?? 0;
      } catch {
        /* ignore parse error — count stays 0 */
      }
      return { ok: true, message: `OK (получено suggestions: ${suggestionsCount})` };
    }
    return {
      ok: false,
      message: `DaData ответила ${statusCode}`,
      details: text.slice(0, 200),
    };
  } catch (err) {
    return { ok: false, message: `Сетевая ошибка: ${(err as Error).message}` };
  }
}

/* ---------- AI test: GET <baseUrl>/models with bearer auth ---------- */

export async function testAi(): Promise<TestResult> {
  const s = await loadSetting("AI");
  if (!s.enabled) return { ok: false, message: "AI отключён в настройках" };
  const cfg = s.config as unknown as AiConfig;
  const secrets = s.secrets as unknown as AiSecrets;
  if (!cfg.baseUrl) return { ok: false, message: "Не задан baseUrl" };
  if (!secrets.apiKey) return { ok: false, message: "Не задан apiKey" };

  const modelsUrl = (cfg.modelsEndpoint && cfg.modelsEndpoint.length > 0)
    ? cfg.modelsEndpoint
    : `${cfg.baseUrl.replace(/\/$/, "")}/models`;
  try {
    const { statusCode, body } = await request(modelsUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secrets.apiKey}`,
      },
      bodyTimeout: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headersTimeout: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    const text = await body.text();
    if (statusCode === 200) {
      let modelCount = 0;
      try {
        const parsed = JSON.parse(text) as { data?: unknown[]; models?: unknown[] };
        modelCount = parsed.data?.length ?? parsed.models?.length ?? 0;
      } catch {
        /* ignore */
      }
      return { ok: true, message: `OK (моделей: ${modelCount})` };
    }
    return {
      ok: false,
      message: `Provider ответил ${statusCode}`,
      details: text.slice(0, 200),
    };
  } catch (err) {
    return { ok: false, message: `Сетевая ошибка: ${(err as Error).message}` };
  }
}

/* ---------- SMTP test: build transport, sendMail to operator ---------- */

export async function testSmtp(testEmail: string, fromOverride?: string): Promise<TestResult> {
  const s = await loadSetting("SMTP");
  if (!s.enabled) return { ok: false, message: "SMTP отключён в настройках" };
  const cfg = s.config as unknown as SmtpConfig;
  const secrets = s.secrets as unknown as SmtpSecrets;
  if (!cfg.host || !cfg.port) return { ok: false, message: "Не заданы host/port" };
  if (!cfg.fromEmail && !fromOverride) {
    return { ok: false, message: "Не задан fromEmail" };
  }
  if (!testEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(testEmail)) {
    return { ok: false, message: "Невалидный адрес получателя" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: !!cfg.secure,
      requireTLS: !!cfg.requireTLS,
      auth: secrets.password
        ? { user: cfg.username, pass: secrets.password }
        : undefined,
      connectionTimeout: DEFAULT_TIMEOUT_MS,
      greetingTimeout: DEFAULT_TIMEOUT_MS,
      socketTimeout: DEFAULT_TIMEOUT_MS,
    });

    const info = await transporter.sendMail({
      from: `${cfg.fromName || "BuhClaude"} <${fromOverride ?? cfg.fromEmail}>`,
      to: testEmail,
      subject: "BuhClaude — SMTP test",
      text: "Это тестовое письмо от BuhClaude. SMTP-настройки рабочие.",
    });
    return { ok: true, message: `Отправлено (messageId: ${info.messageId})` };
  } catch (err) {
    return { ok: false, message: `SMTP error: ${(err as Error).message}` };
  }
}
