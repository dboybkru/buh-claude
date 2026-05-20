// Простой CSV-сериализатор для Excel-совместимости:
// — разделитель ";" (Excel в RU-локали по умолчанию)
// — UTF-8 BOM в начале, чтобы Excel правильно открыл кириллицу
// — кавычки экранируются удвоением, ячейки с ;/"/\n обёрнуты в кавычки

const BOM = "﻿";

function escapeCell(v: unknown): string {
  if (v == null) return "";
  let s: string;
  if (v instanceof Date) {
    s = v.toISOString().slice(0, 10);
  } else if (typeof v === "object") {
    s = JSON.stringify(v);
  } else {
    s = String(v);
  }
  if (/[;"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(";")];
  for (const row of rows) lines.push(row.map(escapeCell).join(";"));
  return BOM + lines.join("\r\n");
}
