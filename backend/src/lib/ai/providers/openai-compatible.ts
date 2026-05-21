// Sprint 6A: OpenAI-compatible провайдер (через undici).
// Подходит для OpenAI, VseGPT, AITunnel, локальных моделей (Ollama),
// любых endpoint-ов с контрактом /v1/chat/completions и /v1/models.

import { request } from "undici";
import type { AiProvider, AiProviderConfig, ChatMessage, ChatResult } from "./types.js";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

interface ModelsResponse {
  data?: Array<{ id: string }>;
}

function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/$/, "") + path;
}

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly cfg: AiProviderConfig) {}

  async chat(messages: ChatMessage[], opts?: { responseFormat?: "json_object" }): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: this.cfg.temperature,
      max_tokens: this.cfg.maxTokens,
    };
    if (opts?.responseFormat === "json_object") body.response_format = { type: "json_object" };

    const { statusCode, body: respBody } = await request(joinUrl(this.cfg.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      headersTimeout: 60_000,
      bodyTimeout: 120_000,
    });
    const text = await respBody.text();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`AI provider HTTP ${statusCode}: ${text.slice(0, 500)}`);
    }
    const parsed = JSON.parse(text) as ChatResponse;
    if (parsed.error) throw new Error(parsed.error.message ?? "AI error");
    const content = parsed.choices?.[0]?.message?.content ?? "";
    return {
      text: content,
      usage: {
        promptTokens: parsed.usage?.prompt_tokens,
        completionTokens: parsed.usage?.completion_tokens,
        totalTokens: parsed.usage?.total_tokens,
      },
    };
  }

  async listModels(): Promise<string[]> {
    const { statusCode, body: respBody } = await request(joinUrl(this.cfg.baseUrl, "/models"), {
      method: "GET",
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
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
}
