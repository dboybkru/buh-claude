// Sprint 6A: MockAIProvider — детерминированные ответы для dev/test без внешней сети.
// Поведение определяется ключевыми словами в последнем user-сообщении:
//
//   "создай контрагента" → create_counterparty
//   "создай счёт"        → create_invoice
//   "не хватает данных"  → план с missingFields, без actions
//   иначе                → информационный план без actions с warning
//
// Контекст в MockAIProvider передаётся через систему — мы парсим из system-сообщения
// строки вида "Контекст: organizationId=...; counterpartyId=...; today=...".

import type { AiProvider, ChatMessage, ChatResult } from "./types.js";
import type { ActionPlan } from "../schemas.js";

const MOCK_MODELS = ["mock-gpt-base", "mock-gpt-instruct", "mock-thinking"];

function extractContext(messages: ChatMessage[]): { organizationId: string | null; counterpartyId: string | null; today: string } {
  // Берём ПОСЛЕДНЕЕ system-сообщение — это контекст от loadAiContext (а не few-shot
  // примеры с hardcoded id из FULL_SYSTEM_PROMPT). System-prompt идёт первым,
  // context — вторым.
  const systems = messages.filter((m) => m.role === "system");
  const sys = systems.length > 0 ? systems[systems.length - 1]!.content : "";
  const orgMatch = /organizationId\s*=\s*"?([0-9a-f-]{36})/i.exec(sys);
  const cpMatch = /counterpartyId\s*=\s*"?([0-9a-f-]{36})/i.exec(sys);
  const dateMatch = /today\s*=\s*"?(\d{4}-\d{2}-\d{2})/i.exec(sys);
  return {
    organizationId: orgMatch?.[1] ?? null,
    counterpartyId: cpMatch?.[1] ?? null,
    today: dateMatch?.[1] ?? new Date().toISOString().slice(0, 10),
  };
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user") return m.content;
  }
  return "";
}

/** Парсим из user-сообщения ИНН (10 или 12 цифр подряд). */
function extractInn(text: string): string | null {
  const m = /(\d{12}|\d{10})/.exec(text);
  return m ? m[1]! : null;
}

/** Парсим краткое название контрагента — последовательность после «ООО»/«ИП».
 *  Останавливаемся на стоп-словах (ИНН, КПП, ОГРН, цифрах) и кавычках.
 *  `\b` в JS regex не работает с кириллицей (только ASCII), поэтому используем (?:^|\s|^|[^А-Яа-я])). */
function extractCounterpartyName(text: string): string | null {
  // ООО «...» или ООО "..."
  const oooQuoted = /(?:^|\s)(ООО\s+[«"][^"»\n]{1,80}[»"])/i.exec(text);
  if (oooQuoted) return oooQuoted[1]!.replace(/\s+/g, " ").trim();
  // ООО Слово
  const ooo = /(?:^|\s)(ООО\s+[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]*(?:\s+[А-ЯЁA-Zа-яёa-z][А-ЯЁA-Zа-яёa-z-]*){0,3})/i.exec(text);
  if (ooo) {
    // отрезаем хвост "ИНН/КПП/ОГРН/цифры" если есть
    const raw = ooo[1]!;
    const cut = raw.replace(/\s+(?:ИНН|КПП|ОГРН|\d).*$/i, "").trim();
    return cut;
  }
  const ip = /(?:^|\s)(ИП\s+[А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z]\.\s*[А-ЯЁA-Z]\.)?)/i.exec(text);
  if (ip) return ip[1]!.trim();
  return null;
}

/** Парсим сумму (целое число рядом со словами «рубл», «₽» или просто число > 0). */
function extractAmount(text: string): number | null {
  const m = /(\d{1,9}(?:[\s ]\d{3})*(?:[.,]\d{1,2})?)\s*(?:руб|₽|р\.|RUB)/i.exec(text);
  if (m) {
    const n = parseFloat(m[1]!.replace(/[\s ]/g, "").replace(",", "."));
    return isFinite(n) ? n : null;
  }
  const m2 = /\b(\d{3,9}(?:[.,]\d{1,2})?)\b/.exec(text);
  if (m2) {
    const n = parseFloat(m2[1]!.replace(",", "."));
    return isFinite(n) ? n : null;
  }
  return null;
}

function extractServiceName(text: string): string {
  // Поиск названия услуги после «за», «на» или «по»
  const m = /(?:за|на|по)\s+([а-яё][а-яё\w\s«»-]{2,50})/i.exec(text);
  if (m) return m[1]!.replace(/[«»"]/g, "").trim();
  return "Услуга";
}

function nextActionId(): string {
  return `mock-${Math.random().toString(36).slice(2, 10)}`;
}

export class MockAIProvider implements AiProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(messages: ChatMessage[], _opts?: { responseFormat?: "json_object" }): Promise<ChatResult> {
    const userText = lastUserText(messages).toLowerCase();
    const { organizationId, counterpartyId, today } = extractContext(messages);

    let plan: ActionPlan;

    if (userText.includes("не хватает данных")) {
      plan = {
        intent: "missing_data",
        summary: "Demonstration: возвращаю план с missingFields, без actions.",
        confidence: 0.4,
        missingFields: ["counterpartyId", "amount", "date"],
        warnings: ["Пример MockAIProvider — пользователь явно попросил сценарий «не хватает данных»."],
        actions: [],
      };
    } else if (userText.includes("создай контрагент") || userText.includes("создать контрагент")) {
      const inn = extractInn(lastUserText(messages));
      const name = extractCounterpartyName(lastUserText(messages)) ?? "ООО Новый контрагент";
      if (!organizationId) {
        plan = {
          intent: "create_counterparty",
          summary: `Хочу создать контрагента ${name}${inn ? " (ИНН " + inn + ")" : ""}, но не передан organizationId.`,
          confidence: 0.5,
          missingFields: ["organizationId"],
          warnings: ["Выберите организацию на странице AI assistant"],
          actions: [],
        };
      } else if (!inn) {
        plan = {
          intent: "create_counterparty",
          summary: `Хочу создать контрагента ${name}, но не указан ИНН.`,
          confidence: 0.5,
          missingFields: ["inn"],
          warnings: ["Укажите ИНН контрагента — 10 или 12 цифр"],
          actions: [],
        };
      } else {
        plan = {
          intent: "create_counterparty",
          summary: `Создать контрагента ${name} (ИНН ${inn}).`,
          confidence: 0.92,
          missingFields: [],
          warnings: [],
          actions: [{
            id: nextActionId(),
            type: "create_counterparty",
            payload: { organizationId, name, inn },
          }],
        };
      }
    } else if (userText.includes("создай счёт") || userText.includes("создать счёт") || userText.includes("создай счет")) {
      const amount = extractAmount(lastUserText(messages)) ?? 0;
      const service = extractServiceName(lastUserText(messages));
      const vat: "no_vat" | 22 = userText.includes("без ндс") ? "no_vat" : 22;
      if (!organizationId || !counterpartyId) {
        const missing: string[] = [];
        if (!organizationId) missing.push("organizationId");
        if (!counterpartyId) missing.push("counterpartyId");
        plan = {
          intent: "create_invoice",
          summary: `Хочу создать счёт${amount ? " на " + amount + " ₽" : ""}, не хватает данных.`,
          confidence: 0.5,
          missingFields: missing,
          warnings: ["Выберите организацию и контрагента на странице AI assistant перед формированием счёта"],
          actions: [],
        };
      } else if (amount <= 0) {
        plan = {
          intent: "create_invoice",
          summary: "Хочу создать счёт, но не определена сумма.",
          confidence: 0.5,
          missingFields: ["price"],
          warnings: ["Укажите сумму счёта в рублях"],
          actions: [],
        };
      } else {
        plan = {
          intent: "create_invoice",
          summary: `Счёт на «${service}» — ${amount} ₽ ${vat === "no_vat" ? "без НДС" : "с НДС 22%"}.`,
          confidence: 0.88,
          missingFields: [],
          warnings: [],
          actions: [{
            id: nextActionId(),
            type: "create_invoice",
            payload: {
              organizationId,
              counterpartyId,
              date: today,
              items: [{ name: service, unit: "шт", quantity: 1, price: amount, vatRate: vat }],
            },
          }],
        };
      }
    } else {
      plan = {
        intent: "unknown_request",
        summary: "Mock AI: запрос не распознан. В Sprint 6A поддерживаются только команды «создай контрагента ...» и «создай счёт ...».",
        confidence: 0.2,
        missingFields: [],
        warnings: ["Mock provider не использует реальную модель. Попробуйте подключить настоящего провайдера в /ai/settings."],
        actions: [],
      };
    }

    return { text: JSON.stringify(plan) };
  }

  async listModels(): Promise<string[]> {
    return [...MOCK_MODELS];
  }

  /** Хелпер для test: возвращает копию списка моделей без обращения к chat. */
  static models(): string[] {
    return [...MOCK_MODELS];
  }
}
