// Клиент DaData (https://dadata.ru/api/). Использует undici (есть в deps).
// Если ключ не задан — операции возвращают `null` (роут вернёт 503).

import { request } from "undici";
import { env } from "./env.js";

const SUGGEST_BASE = "https://suggestions.dadata.ru/suggestions/api/4_1/rs";

export interface DadataPartySuggestion {
  value: string;
  unrestricted_value: string;
  data: {
    inn?: string;
    kpp?: string | null;
    ogrn?: string | null;
    name?: { full?: string; short?: string; full_with_opf?: string; short_with_opf?: string };
    address?: { value?: string; unrestricted_value?: string };
    management?: { name?: string; post?: string };
    state?: { status?: string; actuality_date?: number; registration_date?: number };
    type?: "LEGAL" | "INDIVIDUAL";
    okveds?: Array<{ code: string; name: string; main?: boolean }>;
    okpo?: string | null;
    okato?: string | null;
    oktmo?: string | null;
  };
}

export interface DadataAddressSuggestion {
  value: string;
  unrestricted_value: string;
  data: Record<string, unknown>;
}

export function isDadataConfigured(): boolean {
  return env.DADATA_API_KEY.length > 0;
}

async function call<T>(path: string, body: object): Promise<T> {
  const { statusCode, body: respBody } = await request(`${SUGGEST_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Token ${env.DADATA_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await respBody.text();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`DaData ${path} returned ${statusCode}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

// Поиск по ИНН (или ОГРН). Возвращает массив (обычно 0–1 для ИНН).
export async function findPartyByInn(query: string): Promise<DadataPartySuggestion[]> {
  const data = await call<{ suggestions: DadataPartySuggestion[] }>("/findById/party", {
    query,
    count: 1,
  });
  return data.suggestions;
}

// Подсказки по части названия или ИНН (для autosuggest в форме).
export async function suggestParty(query: string, count = 10): Promise<DadataPartySuggestion[]> {
  const data = await call<{ suggestions: DadataPartySuggestion[] }>("/suggest/party", {
    query,
    count,
  });
  return data.suggestions;
}

export async function suggestAddress(query: string, count = 10): Promise<DadataAddressSuggestion[]> {
  const data = await call<{ suggestions: DadataAddressSuggestion[] }>("/suggest/address", {
    query,
    count,
  });
  return data.suggestions;
}
