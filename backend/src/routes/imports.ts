import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/api-error.js";
import { parseCsv, parseXlsx, buildXlsxTemplate, type ParsedRow } from "../lib/import-parser.js";
import { isValidInn, isValidOgrn } from "../lib/validators.js";
import { contentDisposition } from "../lib/http.js";

const importTypeSchema = z.enum(["counterparties", "nomenclature", "payments"]);
type ImportType = z.infer<typeof importTypeSchema>;

interface ImportLineResult {
  row: number;            // 1-based номер строки в файле (с учётом заголовка)
  data: ParsedRow;        // исходные данные
  status: "ok" | "skipped" | "error";
  errors?: string[];
  /** Что будет создано (для dryRun) или что создано (для apply) */
  preview?: Record<string, unknown>;
}

interface ImportResult {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  lines: ImportLineResult[];
}

// Сопоставление колонок (с допуском синонимов)
const COL_MAP: Record<ImportType, Record<string, string[]>> = {
  counterparties: {
    type:           ["type", "тип"],
    inn:            ["inn", "ИНН"],
    kpp:            ["kpp", "КПП"],
    name:           ["name", "наименование", "название"],
    fullName:       ["fullName", "полное наименование", "полное название"],
    ogrn:           ["ogrn", "ОГРН"],
    legalAddress:   ["legalAddress", "юридический адрес", "адрес"],
    managementName: ["managementName", "руководитель", "фио руководителя"],
    email:          ["email", "почта"],
    phone:          ["phone", "телефон"],
  },
  nomenclature: {
    code:        ["code", "артикул", "код"],
    name:        ["name", "наименование", "название"],
    fullName:    ["fullName", "полное наименование"],
    unitMeasure: ["unitMeasure", "unit", "ед", "единица"],
    type:        ["type", "тип"],
    vatRate:     ["vatRate", "ставка ндс", "ндс"],
    price:       ["price", "цена"],
  },
  payments: {
    date:           ["date", "дата"],
    amount:         ["amount", "сумма"],
    direction:      ["direction", "направление"],
    purpose:        ["purpose", "назначение", "назначение платежа"],
    reference:      ["reference", "номер платежа", "№ п/п"],
    counterpartyInn:["counterpartyInn", "ИНН контрагента", "инн"],
  },
};

function normalizeKeys(row: ParsedRow, type: ImportType): Record<string, string> {
  const map = COL_MAP[type];
  const result: Record<string, string> = {};
  const lowerKeys = Object.keys(row).reduce<Record<string, string>>((acc, k) => {
    acc[k.toLowerCase().trim()] = k;
    return acc;
  }, {});
  for (const [target, synonyms] of Object.entries(map)) {
    for (const syn of synonyms) {
      const k = lowerKeys[syn.toLowerCase().trim()];
      if (k != null && row[k] !== undefined) {
        result[target] = row[k];
        break;
      }
    }
  }
  return result;
}

const ORG_TYPES = ["OOO", "AO", "PAO", "ZAO", "OAO", "IP"] as const;
const NOMEN_TYPES = ["TOVAR", "USLUGA", "RABOTA"] as const;
const PAYMENT_DIRS = ["IN", "OUT"] as const;

async function validateAndDryRun(
  userId: string,
  type: ImportType,
  rows: ParsedRow[],
): Promise<ImportResult> {
  const lines: ImportLineResult[] = [];
  let created = 0, skipped = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw) continue;
    const row = i + 2;  // +2: 1-based + header
    const errors: string[] = [];
    const n = normalizeKeys(raw, type);

    if (type === "counterparties") {
      const t = (n.type || "OOO").toUpperCase();
      if (!ORG_TYPES.includes(t as (typeof ORG_TYPES)[number])) errors.push(`type=${t} — ожидается ${ORG_TYPES.join("|")}`);
      if (!n.inn) errors.push("inn обязателен");
      else if (!isValidInn(n.inn)) errors.push(`inn=${n.inn} — неверная контрольная сумма`);
      if (!n.name) errors.push("name обязателен");
      if (n.ogrn && !isValidOgrn(n.ogrn)) errors.push(`ogrn=${n.ogrn} — неверная контрольная сумма`);

      const existing = !errors.length && n.inn ? await prisma.counterparty.findFirst({ where: { userId, inn: n.inn } }) : null;

      if (errors.length) {
        failed++;
        lines.push({ row, data: raw, status: "error", errors });
      } else if (existing) {
        skipped++;
        lines.push({ row, data: raw, status: "skipped", errors: ["контрагент с этим ИНН уже существует"], preview: { name: existing.name } });
      } else {
        created++;
        lines.push({
          row, data: raw, status: "ok",
          preview: { type: t, inn: n.inn, kpp: n.kpp || null, name: n.name, fullName: n.fullName || null, ogrn: n.ogrn || null, legalAddress: n.legalAddress || null, managementName: n.managementName || null, email: n.email || null, phone: n.phone || null },
        });
      }
    } else if (type === "nomenclature") {
      const t = (n.type || "TOVAR").toUpperCase();
      if (!NOMEN_TYPES.includes(t as (typeof NOMEN_TYPES)[number])) errors.push(`type=${t} — ожидается ${NOMEN_TYPES.join("|")}`);
      if (!n.code) errors.push("code обязателен");
      if (!n.name) errors.push("name обязателен");
      const vat = n.vatRate ? parseFloat(n.vatRate.replace(",", ".")) : 22;
      if (!isFinite(vat) || vat < 0 || vat > 99.99) errors.push(`vatRate=${n.vatRate} некорректен`);
      const price = n.price ? parseFloat(n.price.replace(",", ".")) : null;
      if (price !== null && !isFinite(price)) errors.push(`price=${n.price} некорректен`);

      const existing = !errors.length && n.code ? await prisma.nomenclature.findFirst({ where: { userId, code: n.code } }) : null;

      if (errors.length) {
        failed++;
        lines.push({ row, data: raw, status: "error", errors });
      } else if (existing) {
        skipped++;
        lines.push({ row, data: raw, status: "skipped", errors: ["позиция с этим кодом уже существует"] });
      } else {
        created++;
        lines.push({
          row, data: raw, status: "ok",
          preview: { code: n.code, name: n.name, fullName: n.fullName || null, unitMeasure: n.unitMeasure || "шт", type: t, vatRate: vat, price },
        });
      }
    } else if (type === "payments") {
      // Платежи: дата, сумма, направление, назначение, ИНН контрагента — найдём контрагента
      if (!n.date || !/^\d{4}-\d{2}-\d{2}$/.test(n.date)) errors.push(`date=${n.date} — ожидается ГГГГ-ММ-ДД`);
      const amount = n.amount ? parseFloat(n.amount.replace(/\s/g, "").replace(",", ".")) : 0;
      if (!isFinite(amount) || amount <= 0) errors.push(`amount=${n.amount} некорректен`);
      const dir = (n.direction || "IN").toUpperCase();
      if (!PAYMENT_DIRS.includes(dir as (typeof PAYMENT_DIRS)[number])) errors.push(`direction=${dir} — ожидается IN|OUT`);

      let counterpartyId: string | null = null;
      if (n.counterpartyInn) {
        const cp = await prisma.counterparty.findFirst({ where: { userId, inn: n.counterpartyInn } });
        counterpartyId = cp?.id ?? null;
        if (!cp && n.counterpartyInn) errors.push(`Контрагент с ИНН ${n.counterpartyInn} не найден — создайте контрагента или импортируйте контрагентов сначала`);
      }

      if (errors.length) {
        failed++;
        lines.push({ row, data: raw, status: "error", errors });
      } else {
        created++;
        lines.push({
          row, data: raw, status: "ok",
          preview: { date: n.date, amount, direction: dir, purpose: n.purpose || null, reference: n.reference || null, counterpartyId, counterpartyInn: n.counterpartyInn || null },
        });
      }
    }
  }

  return { total: rows.length, created, skipped, failed, lines };
}

async function applyImport(
  userId: string,
  type: ImportType,
  lines: ImportLineResult[],
  organizationId?: string,
): Promise<{ created: number; failed: number; createdIds: string[] }> {
  const createdIds: string[] = [];
  let created = 0;
  let failed = 0;

  for (const line of lines) {
    if (line.status !== "ok" || !line.preview) continue;
    try {
      if (type === "counterparties") {
        const c = await prisma.counterparty.create({
          data: { userId, ...(line.preview as Record<string, unknown>) } as any,
        });
        createdIds.push(c.id);
        created++;
      } else if (type === "nomenclature") {
        const n = await prisma.nomenclature.create({
          data: { userId, ...(line.preview as Record<string, unknown>) } as any,
        });
        createdIds.push(n.id);
        created++;
      } else if (type === "payments") {
        if (!organizationId) {
          failed++;
          line.status = "error";
          line.errors = [...(line.errors ?? []), "organizationId обязателен для импорта платежей"];
          continue;
        }
        const p = line.preview as { date: string; amount: number; direction: "IN" | "OUT"; purpose: string | null; reference: string | null; counterpartyId: string | null };
        const payment = await prisma.payment.create({
          data: {
            userId,
            organizationId,
            counterpartyId: p.counterpartyId,
            date: new Date(p.date),
            amount: p.amount,
            direction: p.direction,
            method: "BANK",
            purpose: p.purpose,
            reference: p.reference,
          },
        });
        createdIds.push(payment.id);
        created++;
      }
    } catch (err) {
      failed++;
      line.status = "error";
      line.errors = [...(line.errors ?? []), (err as Error).message];
    }
  }

  return { created, failed, createdIds };
}

export async function importsRoutes(app: FastifyInstance) {
  // Multipart на этом плагине
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.addHook("onRequest", app.authenticate);

  // GET /imports/templates/:type — скачать пустой XLSX-шаблон
  app.get("/templates/:type", async (request, reply) => {
    const { type } = z.object({ type: importTypeSchema }).parse(request.params);
    const cols = Object.keys(COL_MAP[type]);
    const examples: Record<ImportType, ParsedRow> = {
      counterparties: { type: "OOO", inn: "7707083893", kpp: "770701001", name: "ООО Альфа", fullName: "", ogrn: "", legalAddress: "г. Москва, ул. ...", managementName: "Иванов И.И.", email: "", phone: "" },
      nomenclature:   { code: "USL-001", name: "Консалтинговые услуги", fullName: "", unitMeasure: "ч", type: "USLUGA", vatRate: "22", price: "5000" },
      payments:       { date: "2026-01-15", amount: "62000", direction: "IN", purpose: "Оплата по счёту", reference: "1234", counterpartyInn: "7728168971" },
    };
    const buf = await buildXlsxTemplate(cols, examples[type]);
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("Content-Disposition", contentDisposition(`Шаблон ${type}`, "xlsx", false));
    return reply.send(buf);
  });

  // POST /imports/:type — multipart с файлом + поле dryRun (true/false) + organizationId (для платежей)
  app.post("/:type", async (request) => {
    const { type } = z.object({ type: importTypeSchema }).parse(request.params);
    const userId = request.user.sub;

    let dryRun = true;
    let organizationId: string | undefined;
    let fileBuf: Buffer | null = null;
    let fileName: string | null = null;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "dryRun") dryRun = String(part.value) !== "false";
        if (part.fieldname === "organizationId" && typeof part.value === "string") organizationId = part.value;
      } else {
        fileName = part.filename;
        fileBuf = await part.toBuffer();
      }
    }

    if (!fileBuf || !fileName) throw Errors.validation("Файл не загружен");

    let rows: ParsedRow[];
    if (fileName.toLowerCase().endsWith(".xlsx")) {
      rows = await parseXlsx(fileBuf);
    } else if (fileName.toLowerCase().endsWith(".csv")) {
      rows = parseCsv(fileBuf.toString("utf-8"));
    } else {
      throw Errors.validation("Поддерживаются только .xlsx и .csv");
    }
    if (rows.length === 0) throw Errors.validation("Файл пустой или нет данных после заголовка");

    const preview = await validateAndDryRun(userId, type, rows);

    if (dryRun) return { dryRun: true, ...preview };

    // Apply
    if (type === "payments" && !organizationId) {
      throw Errors.validation("Для импорта платежей нужно указать organizationId");
    }
    const applied = await applyImport(userId, type, preview.lines, organizationId);
    return {
      dryRun: false,
      total: preview.total,
      created: applied.created,
      skipped: preview.skipped,
      failed: applied.failed + preview.failed,
      lines: preview.lines,
    };
  });
}
