// Генератор examples/bank-statements/sample-bank-statement.xlsx из CSV.
// Запускается единократно: node scripts/gen-bank-sample.mjs
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = resolve(ROOT, "examples/bank-statements/sample-bank-statement.xlsx");
mkdirSync(dirname(out), { recursive: true });

const headers = ["Дата", "Приход", "Расход", "Контрагент", "ИНН", "Назначение платежа", "Номер документа"];
const rows = [
  ["2026-06-01", 60000, "", "ООО Бета", "7728168971", "Оплата по счёту СЧ-0001/2026", "1234"],
  ["2026-06-03", 100000, "", "ООО Бета", "7728168971", "Аванс по договору Д-001/2026", "1235"],
  ["2026-06-05", "", 15000, "ООО Поставщик-Тест", "7704217370", "Оплата за услуги", "п/п 567"],
  ["2026-06-07", 20000, "", "ИП Кузнецов А.Е.", "", "Оплата по счёту № 0002 без ИНН", "1236"],
  ["2026-06-10", "неверная", "", "ООО Бета", "7728168971", "Поступление с битой суммой", "1237"],
];

const wb = new ExcelJS.Workbook();
wb.creator = "BuhClaude";
const ws = wb.addWorksheet("Выписка");
ws.columns = headers.map((h) => ({ header: h, width: Math.max(h.length + 2, 16) }));
ws.getRow(1).font = { bold: true };
for (const r of rows) ws.addRow(r);
await wb.xlsx.writeFile(out);
console.log("Wrote", out);
