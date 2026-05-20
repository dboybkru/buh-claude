// Единый формат ошибок API:
//   { error: { code: string, message: string, details?: unknown } }
//
// Существующие роуты используют плоский формат `{ error, message, details }` —
// они конвертируются автоматически на уровне Fastify onSend hook (см. server.ts).
// Для новых роутов предпочитаем класс ApiError + throw, который ловится setErrorHandler.

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const Errors = {
  notFound: (entity = "Запись") => new ApiError(404, "NotFound", `${entity} не найдена`),
  unauthorized: (message = "Требуется авторизация") => new ApiError(401, "Unauthorized", message),
  forbidden: (message = "Доступ запрещён") => new ApiError(403, "Forbidden", message),
  conflict: (message: string) => new ApiError(409, "Conflict", message),
  validation: (message: string, details?: unknown) => new ApiError(400, "ValidationError", message, details),
  locked: (message: string) => new ApiError(409, "Locked", message),
};

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Конвертирует "плоский" формат {error, message, details} в новый {error: {code, message, details}}. */
export function normalizeErrorPayload(payload: unknown): ApiErrorBody | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  // Уже новый формат — пропускаем
  if (p.error && typeof p.error === "object" && "code" in (p.error as object)) {
    return p as unknown as ApiErrorBody;
  }

  // Плоский формат → вкладываем
  if (typeof p.error === "string") {
    const body: ApiErrorBody = {
      error: {
        code: p.error,
        message: typeof p.message === "string" ? p.message : p.error,
      },
    };
    if (p.details !== undefined) body.error.details = p.details;
    return body;
  }

  // Fastify-internal (например FST_ERR_...) — оборачиваем
  if (typeof p.code === "string" && typeof p.message === "string") {
    return {
      error: { code: p.code, message: p.message, ...(p.details !== undefined ? { details: p.details } : {}) },
    };
  }

  return null;
}
