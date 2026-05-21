// Валидация реквизитов и наличия изображений перед генерацией PDF/preview.
// Не блокирует, а возвращает список warnings — UI показывает их пользователю.

import { extractPrintSettings, type OrgPrintFields } from "./print-settings.js";

/**
 * 3 уровня severity:
 *  - error  : документ выглядит неполным и для отправки клиенту почти всегда нужны правки
 *             (нет ИНН, нет позиций, нет контрагента/организации)
 *  - warning: следует заполнить, но не блокирует отправку (нет КПП у юрлица, нет логотипа
 *             при включённом showLogo, нет банка у счёта)
 *  - info   : мягкая рекомендация (не используется в backend по умолчанию;
 *             зарезервировано для UI и будущих расширений)
 */
export type WarningSeverity = "error" | "warning" | "info";

export interface PrintWarning {
  code: string;
  severity: WarningSeverity;
  message: string;
  /** Опционально — поле, к которому относится предупреждение. */
  field?: string;
}

export type DocumentKind = "invoice" | "act" | "upd" | "waybill" | "reconciliation" | "contract";

interface OrgForWarnings extends Partial<OrgPrintFields> {
  inn?: string | null;
  kpp?: string | null;
  legalAddress?: string | null;
  directorName?: string | null;
  entrepreneurName?: string | null;
  type?: string | null;
  logo?: string | null;
  stamp?: string | null;
  signature?: string | null;
  bankAccounts?: Array<{ id?: string; isDefault?: boolean }> | null;
}

interface CounterpartyForWarnings {
  inn?: string | null;
  name?: string | null;
}

export interface ComputeWarningsInput {
  kind: DocumentKind;
  organization?: OrgForWarnings | null;
  counterparty?: CounterpartyForWarnings | null;
  items?: unknown[] | null;
  // Для договоров — наличие предмета
  subject?: string | null;
}

const warning = (code: string, message: string, field?: string): PrintWarning =>
  ({ code, severity: "warning", message, field });
const error = (code: string, message: string, field?: string): PrintWarning =>
  ({ code, severity: "error", message, field });

export function computePrintWarnings(input: ComputeWarningsInput): PrintWarning[] {
  const out: PrintWarning[] = [];
  const org = input.organization;
  const cp = input.counterparty;
  const items = input.items ?? [];
  const settings = extractPrintSettings(org ?? undefined);

  // Организация
  if (!org) {
    out.push(error("org.missing", "Не указана организация — документ не может быть сформирован"));
  } else {
    if (!org.inn) out.push(error("org.inn", "У организации не указан ИНН", "inn"));
    if (org.type && org.type !== "IP" && !org.kpp) {
      out.push(warning("org.kpp", "У юридического лица не указан КПП", "kpp"));
    }
    if (!org.legalAddress) out.push(warning("org.address", "У организации не указан юридический адрес", "legalAddress"));
    const hasDirector = !!(org.directorName || org.entrepreneurName);
    if (!hasDirector) {
      out.push(warning("org.director", "Не указан руководитель/предприниматель — подпись будет пустой", "directorName"));
    }
    if (settings.showLogo && !org.logo) {
      out.push(warning("org.logo", "Логотип включён в настройках печати, но не загружен", "logo"));
    }
    if (settings.showStamp && !org.stamp) {
      out.push(warning("org.stamp", "Печать включена в настройках печати, но не загружена", "stamp"));
    }
    if (settings.showSignature && !org.signature) {
      out.push(warning("org.signature", "Подпись включена в настройках печати, но не загружена", "signature"));
    }
  }

  // Контрагент
  if (input.kind !== "reconciliation" || cp != null) {
    if (!cp) {
      out.push(error("cp.missing", "Не указан контрагент"));
    } else {
      if (!cp.inn) out.push(warning("cp.inn", "У контрагента не указан ИНН", "counterparty.inn"));
      if (!cp.name) out.push(warning("cp.name", "У контрагента не указано наименование", "counterparty.name"));
    }
  }

  // Позиции — только для документов с items
  if (input.kind === "invoice" || input.kind === "act" || input.kind === "upd" || input.kind === "waybill") {
    if (items.length === 0) {
      out.push(error("items.empty", "В документе нет позиций"));
    }
  }

  // Банковские реквизиты — только для счёта
  if (input.kind === "invoice") {
    const accounts = org?.bankAccounts ?? [];
    if (accounts.length === 0 && settings.showBankDetails) {
      out.push(warning("bank.missing", "Не указан расчётный счёт — банковские реквизиты не попадут в счёт", "bankAccount"));
    }
  }

  // Договор — предмет
  if (input.kind === "contract" && !input.subject) {
    out.push(warning("contract.subject", "Не указан предмет договора"));
  }

  return out;
}

export function hasErrors(warnings: PrintWarning[]): boolean {
  return warnings.some((w) => w.severity === "error");
}

/** Счётчики по severity — для бейджа в UI. */
export function countBySeverity(warnings: PrintWarning[]): Record<WarningSeverity, number> {
  return warnings.reduce<Record<WarningSeverity, number>>(
    (acc, w) => {
      acc[w.severity] = (acc[w.severity] ?? 0) + 1;
      return acc;
    },
    { error: 0, warning: 0, info: 0 },
  );
}
