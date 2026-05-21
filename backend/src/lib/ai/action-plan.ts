// Sprint 6A: парсинг JSON action plan + утилиты выбора approved actions.

import { actionPlanSchema, type ActionPlan, ALLOWED_ACTION_TYPES, type Action } from "./schemas.js";

export interface ParseActionPlanResult {
  ok: boolean;
  plan?: ActionPlan;
  raw: string;
  error?: string;
}

/**
 * Парсит ответ модели как JSON, валидирует по actionPlanSchema.
 *
 * Поведение:
 *  - если JSON невалидный — error: "invalid JSON";
 *  - если структура не совпадает с actionPlanSchema — error: Zod-сообщение;
 *  - если actions содержат неизвестный type — error: "unknown action type" (это случай, когда
 *    discriminatedUnion отбрасывает action);
 *  - иначе возвращает ok=true с типизированным планом.
 */
export function parseActionPlan(rawText: string): ParseActionPlanResult {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch (err) {
    return { ok: false, raw: rawText, error: `invalid JSON: ${(err as Error).message}` };
  }
  // Pre-check action types — даём дружелюбную ошибку
  if (json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).actions)) {
    for (const a of (json as Record<string, unknown>).actions as Array<{ type?: string }>) {
      if (a?.type && !ALLOWED_ACTION_TYPES.includes(a.type as Action["type"])) {
        return {
          ok: false,
          raw: rawText,
          error: `unknown action type "${a.type}"; allowed: ${ALLOWED_ACTION_TYPES.join(", ")}`,
        };
      }
    }
  }
  const parsed = actionPlanSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return {
      ok: false,
      raw: rawText,
      error: first ? `${first.path.join(".")}: ${first.message}` : "schema mismatch",
    };
  }
  return { ok: true, plan: parsed.data, raw: rawText };
}

/** Фильтрует actions по списку approvedActionIds. Если список пуст/undefined — все actions. */
export function selectApprovedActions(plan: ActionPlan, approvedActionIds?: string[]): {
  approved: Action[];
  skipped: Array<{ id: string; actionType: Action["type"]; reason: string }>;
} {
  if (!approvedActionIds || approvedActionIds.length === 0) {
    return { approved: plan.actions, skipped: [] };
  }
  const approvedSet = new Set(approvedActionIds);
  const approved: Action[] = [];
  const skipped: Array<{ id: string; actionType: Action["type"]; reason: string }> = [];
  for (const a of plan.actions) {
    if (approvedSet.has(a.id)) approved.push(a);
    else skipped.push({ id: a.id, actionType: a.type, reason: "not in approved list" });
  }
  return { approved, skipped };
}
