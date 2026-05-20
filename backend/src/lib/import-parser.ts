// Парсер CSV и XLSX в массив объектов (по заголовку первой строки).
// Используется для импорта контрагентов, номенклатуры, платежей.

import ExcelJS from "exceljs";

export type ParsedRow = Record<string, string>;

const BOM = "﻿";

/** Парсит CSV. Поддерживает разделители ';' и ',', экранированные кавычки. UTF-8 BOM срезается. */
export function parseCsv(content: string): ParsedRow[] {
  let text = content;
  if (text.startsWith(BOM)) text = text.slice(1);
  const lines = splitCsvLines(text);
  if (lines.length < 2) return [];

  // Авто-определение разделителя по первой строке
  const firstLine = lines[0] ?? "";
  const sep = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ";" : ",";

  const headers = splitCsvRow(firstLine, sep).map((h) => h.trim());
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const cells = splitCsvRow(raw, sep);
    const row: ParsedRow = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

/** Разделяет CSV на логические строки, уважая кавычки (\n внутри кавычек — часть значения). */
function splitCsvLines(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        cur += '"';
      }
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (cur.length > 0) out.push(cur);
      cur = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      cur += c;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function splitCsvRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === sep && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Парсит XLSX (Excel) первый worksheet. */
export async function parseXlsx(buffer: Buffer): Promise<ParsedRow[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs типизирован под старый Buffer; cast через unknown
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "").trim();
  });

  const rows: ParsedRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: ParsedRow = {};
    headers.forEach((h, idx) => {
      const cell = row.getCell(idx + 1);
      const v = cell.value;
      obj[h] = v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
    });
    if (Object.values(obj).some((v) => v !== "")) rows.push(obj);
  });
  return rows;
}

/** Генерирует пустой XLSX-шаблон с указанными колонками. */
export async function buildXlsxTemplate(columns: string[], example?: ParsedRow): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BuhClaude";
  const ws = wb.addWorksheet("Шаблон");
  ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(c.length + 2, 14) }));
  const header = ws.getRow(1);
  header.font = { bold: true };
  if (example) ws.addRow(example);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
