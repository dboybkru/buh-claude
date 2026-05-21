// Генератор basic.xlsx — запускается из репозитория один раз.
// Хранение xlsx в git'е — норм; этот скрипт нужен только для повторной генерации.
import ExcelJS from "exceljs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "basic.xlsx");
const headers = ["Дата", "Приход", "Расход", "Контрагент", "ИНН", "Назначение платежа", "Номер документа"];
const rows = [
  ["2026-06-01", 60000, "", "ООО Бета", "7728168971", "Оплата по счёту СЧ-0001/2026", "1234"],
  ["2026-06-05", "", 15000, "ООО Поставщик-Тест", "7704217370", "Оплата за услуги", "п/п 567"],
];
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Выписка");
ws.columns = headers.map((h) => ({ header: h, width: 18 }));
ws.getRow(1).font = { bold: true };
for (const r of rows) ws.addRow(r);
await wb.xlsx.writeFile(out);
console.log("Wrote", out);
