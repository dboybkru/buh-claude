// Sprint 6A + 6B + 6C: MockAIProvider — детерминированные ответы для dev/test без внешней сети.
// Поведение определяется ключевыми словами в последнем user-сообщении:
//
//   "создай контрагента"                    → create_counterparty
//   "создай счёт"                           → create_invoice
//   "создай акт по счёту"                   → create_act_from_invoice  (Sprint 6B)
//   "создай договор"                        → create_contract          (Sprint 6B)
//   "покажи должников" / "анализ долгов"    → analyze_debt             (Sprint 6B)
//   "создай платёж" / "входящий платёж" / "исходящий платёж" / "оплат" → create_payment (Sprint 6C)
//   "предложи распределение" / "распредели" → suggest_payment_allocations (Sprint 6C)
//   "не хватает данных"                     → план с missingFields, без actions
//   иначе                                   → информационный план без actions с warning
//
// Контекст в MockAIProvider передаётся через систему — мы парсим из system-сообщения
// строки вида "Контекст: organizationId=...; counterpartyId=...; invoiceId=...; today=...".

import type { AiProvider, ChatMessage, ChatResult } from "./types.js";
import type { ActionPlan } from "../schemas.js";

const MOCK_MODELS = ["mock-gpt-base", "mock-gpt-instruct", "mock-thinking"];

function extractContext(messages: ChatMessage[]): { organizationId: string | null; counterpartyId: string | null; invoiceId: string | null; today: string } {
  // Берём ПОСЛЕДНЕЕ system-сообщение — это контекст от loadAiContext (а не few-shot
  // примеры с hardcoded id из FULL_SYSTEM_PROMPT).
  const systems = messages.filter((m) => m.role === "system");
  const sys = systems.length > 0 ? systems[systems.length - 1]!.content : "";
  const orgMatch = /organizationId\s*=\s*"?([0-9a-f-]{36})/i.exec(sys);
  const cpMatch = /counterpartyId\s*=\s*"?([0-9a-f-]{36})/i.exec(sys);
  const invMatch = /invoiceId\s*=\s*"?([0-9a-f-]{36})/i.exec(sys);
  const dateMatch = /today\s*=\s*"?(\d{4}-\d{2}-\d{2})/i.exec(sys);
  return {
    organizationId: orgMatch?.[1] ?? null,
    counterpartyId: cpMatch?.[1] ?? null,
    invoiceId: invMatch?.[1] ?? null,
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

/** Извлечь subject договора из user-сообщения. Ищем после "договор на/о/об" или ключевых слов. */
function extractSubject(text: string): string | null {
  const m = /договор\s+(?:на|о[бо]?|по)\s+(.+?)(?:[.,;]|$)/i.exec(text);
  if (m) return m[1]!.trim().slice(0, 200);
  const m2 = /предмет[:\s]+(.+?)(?:[.,;]|$)/i.exec(text);
  if (m2) return m2[1]!.trim().slice(0, 200);
  return null;
}

export class MockAIProvider implements AiProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async chat(messages: ChatMessage[], _opts?: { responseFormat?: "json_object" }): Promise<ChatResult> {
    const userTextRaw = lastUserText(messages);
    const userText = userTextRaw.toLowerCase();
    const { organizationId, counterpartyId, invoiceId, today } = extractContext(messages);

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
    } else if (userText.includes("создай акт") || userText.includes("создать акт")) {
      // Sprint 6B — create_act_from_invoice
      if (!organizationId) {
        plan = {
          intent: "create_act_from_invoice",
          summary: "Хочу создать акт, но не выбрана организация.",
          confidence: 0.5,
          missingFields: ["organizationId"],
          warnings: ["Выберите организацию на странице AI assistant"],
          actions: [],
        };
      } else if (!invoiceId) {
        plan = {
          intent: "create_act_from_invoice",
          summary: "Хочу создать акт на основании счёта, но в контексте нет ни одного счёта.",
          confidence: 0.4,
          missingFields: ["invoiceId"],
          warnings: ["Сначала создайте счёт — акт формируется на его основании."],
          actions: [],
        };
      } else {
        plan = {
          intent: "create_act_from_invoice",
          summary: "Создать акт на основании последнего счёта из контекста.",
          confidence: 0.88,
          missingFields: [],
          warnings: [],
          actions: [{
            id: nextActionId(),
            type: "create_act_from_invoice",
            payload: { organizationId, invoiceId, date: today, note: null },
          }],
        };
      }
    } else if (userText.includes("создай договор") || userText.includes("создать договор")) {
      // Sprint 6B — create_contract
      const subject = extractSubject(userTextRaw);
      if (!organizationId) {
        plan = {
          intent: "create_contract",
          summary: "Хочу создать договор, но не выбрана организация.",
          confidence: 0.5,
          missingFields: ["organizationId"],
          warnings: ["Выберите организацию на странице AI assistant"],
          actions: [],
        };
      } else if (!counterpartyId) {
        plan = {
          intent: "create_contract",
          summary: "Хочу создать договор, но не определён контрагент.",
          confidence: 0.5,
          missingFields: ["counterpartyId"],
          warnings: ["В контексте нет контрагентов — создайте контрагента и повторите запрос"],
          actions: [],
        };
      } else if (!subject) {
        plan = {
          intent: "create_contract",
          summary: "Хочу создать договор, но не указан предмет.",
          confidence: 0.5,
          missingFields: ["subject"],
          warnings: ["Уточните: «договор на оказание услуг…», «договор о поставке…» и т.п."],
          actions: [],
        };
      } else {
        const amount = extractAmount(userTextRaw);
        plan = {
          intent: "create_contract",
          summary: `Создать договор с контрагентом, предмет: «${subject}»${amount ? ", сумма " + amount + " ₽" : ""}.`,
          confidence: 0.85,
          missingFields: [],
          warnings: amount ? [] : ["Сумма не указана — будет создан договор без суммы"],
          actions: [{
            id: nextActionId(),
            type: "create_contract",
            payload: {
              organizationId,
              counterpartyId,
              subject,
              ...(amount ? { amount } : {}),
              date: today,
            },
          }],
        };
      }
    } else if (
      userText.includes("предложи распределение") ||
      userText.includes("распредели платёж") ||
      userText.includes("распредели платеж") ||
      userText.includes("распредели сумму") ||
      userText.includes("как распределить")
    ) {
      // Sprint 6C — suggest_payment_allocations (read-only)
      const amount = extractAmount(userTextRaw) ?? 0;
      if (!organizationId) {
        plan = {
          intent: "suggest_payment_allocations",
          summary: "Хочу предложить распределение, но не выбрана организация.",
          confidence: 0.5,
          missingFields: ["organizationId"],
          warnings: ["Выберите организацию"],
          actions: [],
        };
      } else if (!counterpartyId) {
        plan = {
          intent: "suggest_payment_allocations",
          summary: "Хочу предложить распределение, но не определён контрагент.",
          confidence: 0.5,
          missingFields: ["counterpartyId"],
          warnings: ["Укажите контрагента или выберите его в контексте"],
          actions: [],
        };
      } else if (amount <= 0) {
        plan = {
          intent: "suggest_payment_allocations",
          summary: "Хочу предложить распределение, но сумма не определена.",
          confidence: 0.5,
          missingFields: ["amount"],
          warnings: ["Укажите сумму платежа в рублях"],
          actions: [],
        };
      } else {
        plan = {
          intent: "suggest_payment_allocations",
          summary: `Предложить распределение ${amount} ₽ по неоплаченным счетам контрагента.`,
          confidence: 0.92,
          missingFields: [],
          warnings: ["Read-only действие — не изменяет данные."],
          actions: [{
            id: nextActionId(),
            type: "suggest_payment_allocations",
            payload: { organizationId, counterpartyId, amount, asOfDate: today },
          }],
        };
      }
    } else if (
      userText.includes("создай платёж") ||
      userText.includes("создай платеж") ||
      userText.includes("создай оплату") ||
      userText.includes("входящий платёж") ||
      userText.includes("входящий платеж") ||
      userText.includes("исходящий платёж") ||
      userText.includes("исходящий платеж") ||
      userText.includes("оплата по счёту") ||
      userText.includes("оплата по счету")
    ) {
      // Sprint 6C — create_payment
      const amount = extractAmount(userTextRaw) ?? 0;
      const direction: "IN" | "OUT" = userText.includes("исходящ") ? "OUT" : "IN";
      const missing: string[] = [];
      if (!organizationId) missing.push("organizationId");
      if (!counterpartyId) missing.push("counterpartyId");
      if (amount <= 0) missing.push("amount");

      if (missing.length > 0) {
        plan = {
          intent: "create_payment",
          summary: `Хочу создать ${direction === "IN" ? "входящий" : "исходящий"} платёж, не хватает данных.`,
          confidence: 0.5,
          missingFields: missing,
          warnings: ["Уточните организацию, контрагента и сумму платежа"],
          actions: [],
        };
      } else {
        // IN с привязкой к счёту "по счёту" → один allocation на всю сумму, если invoiceId есть в контексте
        const wantsInvoice = direction === "IN" && (
          userText.includes("по счёту") || userText.includes("по счету") || userText.includes("оплата по")
        );
        const allocations = wantsInvoice && invoiceId
          ? [{ invoiceId, amount }]
          : undefined;

        plan = {
          intent: "create_payment",
          summary: direction === "IN"
            ? `Создать входящий платёж на ${amount} ₽${allocations ? ` с привязкой к счёту` : " (аванс)"}.`
            : `Создать исходящий платёж на ${amount} ₽.`,
          confidence: 0.88,
          missingFields: [],
          warnings: direction === "OUT"
            ? ["Исходящий платёж — без привязки к нашим счетам."]
            : (allocations ? [] : ["Сумма попадёт в аванс — счёт не привязан."]),
          actions: [{
            id: nextActionId(),
            type: "create_payment",
            payload: {
              // organizationId/counterpartyId уже проверены выше через missing array — здесь они не null
              organizationId: organizationId!,
              counterpartyId: counterpartyId!,
              date: today,
              amount,
              direction,
              method: "BANK",
              ...(allocations ? { allocations } : {}),
            },
          }],
        };
      }
    } else if (
      userText.includes("покажи должник") ||
      userText.includes("должников") ||
      userText.includes("анализ долг") ||
      userText.includes("анализ задолж")
    ) {
      // Sprint 6B — analyze_debt
      if (!organizationId) {
        plan = {
          intent: "analyze_debt",
          summary: "Хочу проанализировать задолженности, но не выбрана организация.",
          confidence: 0.5,
          missingFields: ["organizationId"],
          warnings: ["Выберите организацию на странице AI assistant"],
          actions: [],
        };
      } else {
        plan = {
          intent: "analyze_debt",
          summary: counterpartyId
            ? "Проанализировать задолженность выбранного контрагента."
            : "Проанализировать задолженности по организации (топ должников).",
          confidence: 0.92,
          missingFields: [],
          warnings: ["Read-only действие — не изменяет данные."],
          actions: [{
            id: nextActionId(),
            type: "analyze_debt",
            payload: {
              organizationId,
              ...(counterpartyId ? { counterpartyId } : {}),
              asOfDate: today,
            },
          }],
        };
      }
    } else {
      plan = {
        intent: "unknown_request",
        summary: "Mock AI: запрос не распознан. Поддерживаются: «создай контрагента ...», «создай счёт ...», «создай акт по счёту», «создай договор ...», «покажи должников», «создай платёж ...», «предложи распределение ...».",
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
