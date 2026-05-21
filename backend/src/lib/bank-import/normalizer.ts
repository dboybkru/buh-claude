// Нормализация одной строки банковской выписки.
// Распознаёт типовые названия колонок (русский + английский, разные банки),
// конвертирует дату, сумму, направление. Заполняет errors[] / warnings[].
//
// Принципы:
// - direction: если есть отдельные income/expense колонки — по непустой;
//   иначе если есть direction явно — по нему;
//   иначе если знак суммы — по знаку (отрицательная = OUT);
//   иначе по умолчанию IN.
// - date: пробуем YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, ISO datetime.

import type { RawBankRow, NormalizedBankRow } from "./types.js";

// Синонимы колонок (lowercase). Каждый поле — массив возможных названий.
const COL_SYNONYMS = {
  date:             ["date", "дата", "дата операции", "дата проводки", "дата документа", "operation date"],
  amount:           ["amount", "сумма", "сумма операции", "amount rub"],
  income:           ["income", "приход", "кредит", "поступление", "поступления", "credit", "приход (руб.)"],
  expense:          ["expense", "расход", "дебет", "списание", "списания", "debit", "расход (руб.)"],
  direction:        ["direction", "тип", "тип операции", "direction"],
  purpose:          ["purpose", "назначение", "назначение платежа", "комментарий", "description", "purpose of payment"],
  counterpartyName: ["counterpartyname", "counterparty", "контрагент", "плательщик", "получатель", "наименование", "name", "client name"],
  counterpartyInn:  ["counterpartyinn", "inn", "инн", "инн контрагента", "инн плательщика", "инн получателя", "tax id"],
  reference:        ["reference", "номер документа", "номер операции", "id операции", "doc id", "doc no", "номер п/п", "№ п/п", "n п/п", "номер", "document number"],
  account:          ["account", "счёт", "счет", "расчётный счёт", "расчетный счёт", "р/с", "bank account"],
} as const;

type FieldKey = keyof typeof COL_SYNONYMS;

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/[\s_·.]+/g, " ").trim();
}

/**
 * Строит индекс {fieldKey → исходное название колонки} для одной выписки.
 * Делается один раз на файл (а не на строку) для скорости и единообразия.
 */
export function detectColumns(headers: string[]): Partial<Record<FieldKey, string>> {
  const index: Partial<Record<FieldKey, string>> = {};
  const headerByLower = new Map<string, string>();
  for (const h of headers) headerByLower.set(normalizeKey(h), h);

  for (const [field, synonyms] of Object.entries(COL_SYNONYMS) as Array<[FieldKey, readonly string[]]>) {
    for (const syn of synonyms) {
      const found = headerByLower.get(normalizeKey(syn));
      if (found != null) {
        index[field] = found;
        break;
      }
    }
  }
  return index;
}

function parseDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;

  // YYYY-MM-DD или ISO datetime
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) {
    const d = (m[1] ?? "").padStart(2, "0");
    const mo = (m[2] ?? "").padStart(2, "0");
    return `${m[3]}-${mo}-${d}`;
  }

  // DD.MM.YY → дополним 20YY
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/);
  if (m) {
    const d = (m[1] ?? "").padStart(2, "0");
    const mo = (m[2] ?? "").padStart(2, "0");
    return `20${m[3]}-${mo}-${d}`;
  }
  return null;
}

function parseAmount(s: string | undefined): number | null {
  if (!s) return null;
  // Убираем пробелы (включая неразрывный) и заменяем запятую на точку
  const cleaned = s.replace(/[\s ]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return null;
  return n;
}

function pickValue(raw: Record<string, string>, columnName: string | undefined): string | undefined {
  if (!columnName) return undefined;
  const v = raw[columnName];
  if (v == null) return undefined;
  const trimmed = String(v).trim();
  return trimmed === "" ? undefined : trimmed;
}

export function detectDirection(
  raw: Record<string, string>,
  cols: Partial<Record<FieldKey, string>>,
): { direction: "IN" | "OUT" | null; amount: number | null; warnings: string[] } {
  const warnings: string[] = [];
  const income = parseAmount(pickValue(raw, cols.income));
  const expense = parseAmount(pickValue(raw, cols.expense));

  // Случай 1: отдельные колонки приход/расход
  if ((income ?? 0) > 0 && (expense ?? 0) > 0) {
    warnings.push("Заполнены и приход, и расход одновременно — взят приход");
    return { direction: "IN", amount: income ?? 0, warnings };
  }
  if (income != null && income > 0) return { direction: "IN", amount: income, warnings };
  if (expense != null && expense > 0) return { direction: "OUT", amount: expense, warnings };

  // Случай 2: явное direction + сумма
  const explicit = pickValue(raw, cols.direction)?.toUpperCase();
  let dir: "IN" | "OUT" | null = null;
  if (explicit === "IN" || explicit === "ПРИХОД" || explicit === "КРЕДИТ") dir = "IN";
  else if (explicit === "OUT" || explicit === "РАСХОД" || explicit === "ДЕБЕТ") dir = "OUT";

  const amountStr = pickValue(raw, cols.amount);
  const amountSigned = parseAmount(amountStr);
  if (amountSigned == null) return { direction: dir, amount: null, warnings };

  if (dir) return { direction: dir, amount: Math.abs(amountSigned), warnings };

  // Случай 3: только сумма со знаком — отрицательная = OUT
  if (amountSigned < 0) return { direction: "OUT", amount: Math.abs(amountSigned), warnings };
  if (amountSigned > 0) return { direction: "IN", amount: amountSigned, warnings };

  return { direction: null, amount: null, warnings };
}

export function normalizeBankRow(
  row: RawBankRow,
  cols: Partial<Record<FieldKey, string>>,
): NormalizedBankRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const dateStr = pickValue(row.raw, cols.date);
  const date = parseDate(dateStr);
  if (!date) errors.push(`Не удалось распарсить дату «${dateStr ?? ""}»`);

  const { direction, amount, warnings: dirWarnings } = detectDirection(row.raw, cols);
  warnings.push(...dirWarnings);
  if (amount == null) errors.push("Сумма не указана или невалидна");
  else if (amount <= 0) errors.push("Сумма должна быть > 0");
  if (!direction) errors.push("Не удалось определить направление (приход/расход)");

  const inn = pickValue(row.raw, cols.counterpartyInn);
  if (inn && !/^\d{10}(\d{2})?$/.test(inn)) {
    warnings.push(`ИНН «${inn}» не соответствует формату (10 или 12 цифр)`);
  }

  return {
    rowNumber: row.rowNumber,
    date,
    amount,
    direction,
    purpose: pickValue(row.raw, cols.purpose) ?? null,
    counterpartyName: pickValue(row.raw, cols.counterpartyName) ?? null,
    counterpartyInn: inn ?? null,
    reference: pickValue(row.raw, cols.reference) ?? null,
    account: pickValue(row.raw, cols.account) ?? null,
    raw: row.raw,
    errors,
    warnings,
  };
}
