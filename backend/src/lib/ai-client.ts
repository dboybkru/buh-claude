// OpenAI-compatible клиент через undici. Все провайдеры (OpenAI, VseGPT,
// AITunnel, локальные совместимые сервера) общаются по тому же контракту
// /v1/chat/completions и /v1/models, поэтому одного клиента достаточно.

import { request } from "undici";

export interface AiConfig {
  apiKey: string;
  baseUrl: string;     // например https://api.openai.com/v1
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

interface ModelsResponse {
  data?: Array<{ id: string; object?: string; owned_by?: string }>;
}

function url(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/$/, "") + path;
}

export async function chatCompletion(cfg: AiConfig, messages: ChatMessage[], opts?: { responseFormat?: "json_object" }): Promise<{ text: string; raw: ChatResponse }> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  };
  if (opts?.responseFormat === "json_object") body.response_format = { type: "json_object" };

  const { statusCode, body: respBody } = await request(url(cfg.baseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    headersTimeout: 60_000,
    bodyTimeout: 120_000,
  });
  const text = await respBody.text();
  if (statusCode < 200 || statusCode >= 300) {
    const detail = text.slice(0, 500);
    throw new Error(`AI provider HTTP ${statusCode}: ${detail}`);
  }
  const parsed = JSON.parse(text) as ChatResponse;
  if (parsed.error) throw new Error(parsed.error.message ?? "AI error");
  const content = parsed.choices?.[0]?.message?.content ?? "";
  return { text: content, raw: parsed };
}

export async function listModels(cfg: Pick<AiConfig, "apiKey" | "baseUrl">): Promise<string[]> {
  const { statusCode, body: respBody } = await request(url(cfg.baseUrl, "/models"), {
    method: "GET",
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
  });
  const text = await respBody.text();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`AI provider HTTP ${statusCode}: ${text.slice(0, 500)}`);
  }
  const parsed = JSON.parse(text) as ModelsResponse;
  return (parsed.data ?? []).map((m) => m.id).filter(Boolean);
}
