// Клиент DaData (https://dadata.ru/api/). Использует undici (есть в deps).
// Если ключ не задан — операции возвращают `null` (роут вернёт 503).
//
// Sprint 10: token+secret сначала читаются из IntegrationSetting(category=DADATA),
// fallback на env.DADATA_API_KEY / env.DADATA_SECRET_KEY для backward-compat.

import { request } from "undici";
import { env } from "./env.js";
import { loadSetting } from "./system-settings.js";

const SUGGEST_BASE_DEFAULT = "https://suggestions.dadata.ru/suggestions/api/4_1/rs";

interface ActiveDadata {
  token: string;
  secret: string;
  baseUrl: string;
}

/**
 * Resolves the live DaData credentials. Order:
 *   1. IntegrationSetting(category=DADATA, enabled=true) with token present
 *   2. env.DADATA_API_KEY (legacy fallback)
 * Returns null when neither source is usable.
 */
export async function getActiveDadata(): Promise<ActiveDadata | null> {
  try {
    const s = await loadSetting("DADATA");
    const token = (s.secrets["token"] ?? "").trim();
    if (s.enabled && token.length > 0) {
      return {
        token,
        secret: (s.secrets["secret"] ?? "").trim(),
        baseUrl: ((s.config as Record<string, unknown>).suggestionsUrl as string | undefined)
          ?? ((s.config as Record<string, unknown>).baseUrl as string | undefined)
          ?? SUGGEST_BASE_DEFAULT,
      };
    }
  } catch {
    // IntegrationSetting не доступна (миграция не применена / БД недоступна)
    // — выпадем в env fallback ниже.
  }
  if (env.DADATA_API_KEY.length > 0) {
    return {
      token: env.DADATA_API_KEY,
      secret: env.DADATA_SECRET_KEY,
      baseUrl: SUGGEST_BASE_DEFAULT,
    };
  }
  return null;
}

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

/**
 * Sync legacy check used by routes/dadata.ts and a few env-time helpers.
 * Returns true if env legacy key is set. For the DB-aware version use
 * `await getActiveDadata()` which also covers IntegrationSetting.
 */
export function isDadataConfigured(): boolean {
  return env.DADATA_API_KEY.length > 0;
}

async function call<T>(path: string, body: object): Promise<T> {
  const active = await getActiveDadata();
  if (!active) {
    throw new Error("DaData не настроена (ни IntegrationSetting, ни env)");
  }
  const url = `${active.baseUrl.replace(/\/$/, "")}${path}`;
  const { statusCode, body: respBody } = await request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Token ${active.token}`,
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
