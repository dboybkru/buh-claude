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

export function extractApiError(err: unknown): ApiError {
  if (err instanceof AxiosError && err.response?.data) {
    return err.response.data as ApiError;
  }
  return { error: "UnknownError", message: err instanceof Error ? err.message : String(err) };
}
