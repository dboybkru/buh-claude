import axios, { AxiosError } from "axios";

const TOKEN_KEY = "buhclaude.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({
  baseURL: "/api/v1",
  timeout: 30_000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (resp) => resp,
  (error: AxiosError) => {
    // 401 — токен битый/просрочен → выкидываем, фронт перенаправит на /login
    if (error.response?.status === 401 && getToken()) {
      setToken(null);
      // hard redirect, чтобы AuthContext перечитал состояние
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export interface ApiError {
  error: string;
  message?: string;
  details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
  statusCode?: number;
}

/**
 * Парсит ответ API.
 * Поддерживает оба формата:
 *   { error: { code, message, details } }   — новый (единый формат)
 *   { error: "Code", message, details }     — легаси (только для старого клиента)
 */
export function extractApiError(err: unknown): ApiError {
  if (err instanceof AxiosError && err.response?.data) {
    const data = err.response.data as Record<string, unknown>;
    // Новый формат
    if (data.error && typeof data.error === "object" && "code" in (data.error as object)) {
      const e = data.error as { code: string; message?: string; details?: ApiError["details"] };
      return { error: e.code, message: e.message, details: e.details };
    }
    // Легаси
    return data as ApiError;
  }
  return { error: "UnknownError", message: err instanceof Error ? err.message : String(err) };
}
