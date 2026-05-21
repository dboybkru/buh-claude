// Парсер банковской выписки: CSV/XLSX → массив RawBankRow.
// Использует общий import-parser.ts (parseCsv/parseXlsx).

import { parseCsv, parseXlsx } from "../import-parser.js";
import type { RawBankRow } from "./types.js";

export async function parseBankStatement(
  buffer: Buffer,
  fileName: string,
): Promise<RawBankRow[]> {
  const lower = fileName.toLowerCase();
  let rows;
  if (lower.endsWith(".xlsx")) {
    rows = await parseXlsx(buffer);
  } else if (lower.endsWith(".csv")) {
    rows = parseCsv(buffer.toString("utf-8"));
  } else {
    throw new Error("Поддерживаются только .csv и .xlsx");
  }
  return rows.map((raw, idx) => ({
    rowNumber: idx + 2, // +2: пропустили header (row 1), индексация 1-based
    raw,
  }));
}
