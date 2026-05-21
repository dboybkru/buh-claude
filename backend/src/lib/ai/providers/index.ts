// Sprint 6A: фабрика провайдеров по provider-строке.

import { OpenAiCompatibleProvider } from "./openai-compatible.js";
import { MockAIProvider } from "./mock.js";
import type { AiProvider, AiProviderConfig } from "./types.js";

export type ProviderKind = "openai" | "vsegpt" | "aitunnel" | "custom" | "local" | "mock";

/** Создаёт провайдера по строковому ключу. Все OpenAI-совместимые провайдеры
 *  используют один и тот же класс с разным baseUrl. */
export function createProvider(kind: string, cfg: AiProviderConfig): AiProvider {
  if (kind === "mock") return new MockAIProvider();
  return new OpenAiCompatibleProvider(cfg);
}

export { OpenAiCompatibleProvider, MockAIProvider };
export type { AiProvider, AiProviderConfig, ChatMessage, ChatResult } from "./types.js";
