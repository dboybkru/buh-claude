// Sprint 6A: общий интерфейс AI-провайдера. И OpenAI-compatible, и Mock провайдер
// реализуют этот контракт — за счёт этого route-слой и тесты не зависят от
// конкретной реализации.

export interface AiProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  /** Сырой ответ модели — может быть строкой JSON или произвольным текстом. */
  text: string;
  /** Если у провайдера есть данные usage (token consumption) — кладём сюда. */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface AiProvider {
  /** Завершает чат и возвращает ответ модели. */
  chat(messages: ChatMessage[], opts?: { responseFormat?: "json_object" }): Promise<ChatResult>;
  /** Возвращает список идентификаторов доступных моделей. Не все провайдеры это поддерживают. */
  listModels(): Promise<string[]>;
}
