import { toast } from "sonner";
import { extractApiError } from "./api";

/**
 * Универсальная обработка ошибок API:
 *  - 409 → "конфликт" с message
 *  - 4xx с details.fieldErrors → разворачивает в plain-текст с переводом полей
 *  - 5xx и прочее → fallback message
 */
export function handleApiError(err: unknown, fallback = "Произошла ошибка"): string {
  const api = extractApiError(err);
  const fieldErrors = api.details?.fieldErrors;
  if (fieldErrors) {
    const msgs = Object.entries(fieldErrors).map(([k, v]) => `${k}: ${(v ?? []).join(", ")}`);
    if (msgs.length > 0) {
      const text = msgs.join("; ");
      toast.error(text);
      return text;
    }
  }
  const text = api.message ?? fallback;
  toast.error(text);
  return text;
}
