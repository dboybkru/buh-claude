import type { FastifyInstance } from "fastify";
import { z } from "zod";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma.js";
import { toCsv } from "../lib/csv.js";
import { contentDisposition } from "../lib/http.js";

const typeSchema = z.enum(["invoices", "acts", "upds", "waybills"]);

const LABELS = {
  invoices: { ru: "Счета", header: "Счета на оплату" },
  acts: { ru: "Акты", header: "Акты выполненных работ" },
  upds: { ru: "УПД", header: "Универсальные передаточные документы" },
  waybills: { ru: "Накладные", header: "Товарные накладные ТОРГ-12" },
} as const;

interface DocRow {
  number: string;
  date: Date;
  organization: string;
  counterparty: string;
  inn: string;
  status: string;
  subtotal: number;
  vatAmount: number;
  total: number;
}

async function loadRows(userId: string, type: z.infer<typeof typeSchema>): Promise<DocRow[]> {
  const include = {
    organization: { select: { name: true } },
    counterparty: { select: { name: true, inn: true } },
  } as const;
  const orderBy = { date: "desc" as const };

  const map = (docs: Array<{
    number: string; date: Date; status: string;
    subtotal: unknown; vatAmount: unknown; total: unknown;
    organization: { name: string }; counterparty: { name: string; inn: string };
  }>): DocRow[] =>
    docs.map((d) => ({
      number: d.number,
      date: d.date,
      organization: d.organization.name,
      counterparty: d.counterparty.name,
      inn: d.counterparty.inn,
      status: d.status,
      subtotal: parseFloat(String(d.subtotal)),
      vatAmount: parseFloat(String(d.vatAmount)),
      total: parseFloat(String(d.total)),
    }));

  if (type === "invoices") return map(await prisma.invoice.findMany({ where: { userId }, orderBy, include }));
  if (type === "acts") return map(await prisma.act.findMany({ where: { userId }, orderBy, include }));
  if (type === "upds") return map(await prisma.updDocument.findMany({ where: { userId }, orderBy, include }));
  return map(await prisma.waybill.findMany({ where: { userId }, orderBy, include }));
}

const HEADERS = ["Номер", "Дата", "Организация", "Контрагент", "ИНН контрагента", "Статус", "Сумма без НДС", "НДС", "Итого с НДС"];

function rowsToCsvData(rows: DocRow[]): unknown[][] {
  return rows.map((r) => [r.number, r.date, r.organization, r.counterparty, r.inn, r.status, r.subtotal, r.vatAmount, r.total]);
}

export async function exportRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/:type.csv", async (request, reply) => {
    const { type } = z.object({ type: typeSchema }).parse(request.params);
    const rows = await loadRows(request.user.sub, type);
    const csv = toCsv(HEADERS, rowsToCsvData(rows));
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", contentDisposition(`${LABELS[type].ru}-${new Date().toISOString().slice(0, 10)}`, "csv", false));
    return reply.send(csv);
  });

  app.get("/:type.xlsx", async (request, reply) => {
    const { type } = z.object({ type: typeSchema }).parse(request.params);
    const rows = await loadRows(request.user.sub, type);
    const wb = new ExcelJS.Workbook();
    wb.creator = "BuhClaude";
    wb.created = new Date();
    const ws = wb.addWorksheet(LABELS[type].ru);

    ws.columns = [
      { header: "Номер", key: "number", width: 18 },
      { header: "Дата", key: "date", width: 12, style: { numFmt: "dd.mm.yyyy" } },
      { header: "Организация", key: "organization", width: 30 },
      { header: "Контрагент", key: "counterparty", width: 30 },
      { header: "ИНН контрагента", key: "inn", width: 14 },
      { header: "Статус", key: "status", width: 12 },
      { header: "Сумма без НДС", key: "subtotal", width: 14, style: { numFmt: "#,##0.00" } },
      { header: "НДС", key: "vatAmount", width: 12, style: { numFmt: "#,##0.00" } },
      { header: "Итого с НДС", key: "total", width: 14, style: { numFmt: "#,##0.00" } },
    ];

    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle", horizontal: "center" };

    for (const r of rows) ws.addRow(r);

    // Итоговая строка
    if (rows.length > 0) {
      const sum = (k: keyof DocRow) => rows.reduce((s, r) => s + Number(r[k]), 0);
      const totalRow = ws.addRow({
        number: "ИТОГО",
        subtotal: sum("subtotal"),
        vatAmount: sum("vatAmount"),
        total: sum("total"),
      });
      totalRow.font = { bold: true };
    }

    ws.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await wb.xlsx.writeBuffer();
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", contentDisposition(`${LABELS[type].ru}-${new Date().toISOString().slice(0, 10)}`, "xlsx", false));
    return reply.send(Buffer.from(buffer));
  });
}
