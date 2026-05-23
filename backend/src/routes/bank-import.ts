// Импорт банковской выписки: preview → confirm.
//
// Preview парсит файл, нормализует строки, подбирает контрагентов и счета.
// В БД ничего не пишется. Результат сохраняется во встроенном in-memory store
// под importId; confirm применяет уточнённый пользователем набор.
//
// Дубль-детект делается на confirm:
//   - если задан reference: по (organizationId, reference, date, amount, direction);
//   - иначе fallback: по (organizationId, date, amount, direction, purpose).

import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/api-error.js";
import {
  parseBankStatement,
  detectColumns,
  normalizeBankRow,
  suggestCounterparty,
  suggestInvoiceAllocations,
  savePreview,
  getPreview,
  dropPreview,
} from "../lib/bank-import/index.js";
import type { PreviewRow, PreviewSummary } from "../lib/bank-import/types.js";
import { createPaymentInTx } from "../lib/payments-service.js";
import { requireOrgAccess } from "../lib/org-access.js";

const allocationSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.coerce.number().positive(),
});

const confirmRowSchema = z.object({
  rowNumber: z.number().int().nonnegative(),
  action: z.enum(["import", "skip"]),
  counterpartyId: z.string().uuid().optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата ГГГГ-ММ-ДД"),
  amount: z.coerce.number().positive(),
  direction: z.enum(["IN", "OUT"]),
  purpose: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  allocations: z.array(allocationSchema).optional(),
});

const confirmSchema = z.object({
  importId: z.string().uuid(),
  rows: z.array(confirmRowSchema).min(1),
});

const EPS = 0.005;

export async function bankImportRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.addHook("onRequest", app.authenticate);

  // POST /preview — multipart с файлом + organizationId + bankAccountId (optional)
  app.post("/preview", async (request) => {
    const userId = request.user.sub;

    let organizationId: string | null = null;
    let bankAccountId: string | null = null;
    let fileBuf: Buffer | null = null;
    let fileName: string | null = null;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "field") {
        if (part.fieldname === "organizationId" && typeof part.value === "string") organizationId = part.value;
        if (part.fieldname === "bankAccountId" && typeof part.value === "string" && part.value) bankAccountId = part.value;
      } else {
        fileName = part.filename;
        fileBuf = await part.toBuffer();
      }
    }

    if (!organizationId) throw Errors.validation("organizationId обязателен");
    if (!fileBuf || !fileName) throw Errors.validation("Файл не загружен");

    // Sprint 9: bank import requires ACCOUNTANT+ in the target org.
    await requireOrgAccess(prisma, userId, organizationId, "bank:import");
    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!org) throw Errors.validation("Организация не найдена");
    if (bankAccountId) {
      const ba = await prisma.bankAccount.findFirst({
        where: { id: bankAccountId, organizationId },
        select: { id: true },
      });
      if (!ba) throw Errors.validation("Банковский счёт не найден или принадлежит другой организации");
    }

    let rawRows;
    try {
      rawRows = await parseBankStatement(fileBuf, fileName);
    } catch (err) {
      throw Errors.validation((err as Error).message);
    }
    if (rawRows.length === 0) throw Errors.validation("В файле нет строк данных");

    // Колонки — общие для всего файла, берём заголовки из первой строки
    const firstRaw = rawRows[0]?.raw ?? {};
    const cols = detectColumns(Object.keys(firstRaw));

    const previewRows: PreviewRow[] = [];
    let ready = 0, needsReview = 0, errors = 0, totalIncome = 0, totalExpense = 0;

    for (const raw of rawRows) {
      const norm = normalizeBankRow(raw, cols);

      let cpId: string | null = null;
      let cpReason = "";
      if (norm.errors.length === 0 && norm.direction != null) {
        const cp = await suggestCounterparty({ prisma, userId, row: norm });
        cpId = cp.counterpartyId;
        cpReason = cp.reason;
        if (!cpId) norm.warnings.push(`Контрагент не определён: ${cpReason}`);
      }

      let allocs: PreviewRow["suggestedInvoiceAllocations"] = [];
      if (norm.errors.length === 0 && norm.direction === "IN" && cpId && norm.amount != null) {
        allocs = await suggestInvoiceAllocations({
          prisma, userId, organizationId,
          counterpartyId: cpId,
          amount: norm.amount,
          purpose: norm.purpose,
        });
      }

      // Status
      let status: PreviewRow["status"];
      if (norm.errors.length > 0) status = "error";
      else if (norm.direction === "IN" && !cpId) status = "needs_review";
      else if (norm.direction === "IN" && allocs.length === 0 && norm.amount && norm.amount > 0) {
        // Контрагент найден, но счетов нет — будет аванс. Это допустимо, но желательна проверка.
        status = "needs_review";
      }
      else if (allocs.some((a) => a.confidence < 0.7)) status = "needs_review";
      else status = "ready";

      previewRows.push({
        ...norm,
        suggestedCounterpartyId: cpId,
        suggestedInvoiceAllocations: allocs,
        status,
      });

      if (status === "ready") ready++;
      else if (status === "needs_review") needsReview++;
      else errors++;

      if (norm.direction === "IN" && norm.amount) totalIncome += norm.amount;
      else if (norm.direction === "OUT" && norm.amount) totalExpense += norm.amount;
    }

    const summary: PreviewSummary = {
      totalRows: previewRows.length,
      ready, needsReview, errors,
      totalIncome: Math.round(totalIncome * 100) / 100,
      totalExpense: Math.round(totalExpense * 100) / 100,
    };

    const { importId } = savePreview({
      userId,
      organizationId,
      bankAccountId,
      fileName,
      payload: { rows: previewRows, summary },
    });

    return {
      importId,
      organizationId,
      bankAccountId,
      fileName,
      rows: previewRows,
      summary,
    };
  });

  // POST /confirm — применяет уточнённые пользователем строки.
  app.post("/confirm", async (request) => {
    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные параметры", parsed.error.flatten());
    const userId = request.user.sub;

    const preview = getPreview(parsed.data.importId, userId);
    if (!preview) {
      throw Errors.validation("Сессия предпросмотра не найдена или истекла. Загрузите файл заново.");
    }
    const { organizationId, bankAccountId: previewBankAccount } = preview.meta;
    // Sprint 9: confirm requires the same write-perm as preview.
    await requireOrgAccess(prisma, userId, organizationId, "bank:import");
    const orgRow = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { userId: true },
    });
    const ownerUserId = orgRow?.userId ?? userId;

    const createdPayments: string[] = [];
    const skippedRows: number[] = [];
    const errorsOut: Array<{ rowNumber: number; message: string }> = [];

    for (const r of parsed.data.rows) {
      if (r.action === "skip") {
        skippedRows.push(r.rowNumber);
        continue;
      }

      // Безопасность: bankAccountId — либо из preview-сессии, либо явный валидный
      const bankAccountId = r.bankAccountId ?? previewBankAccount ?? null;

      try {
        // Идемпотентность: проверим дубль ДО транзакции.
        const dupWhere: Parameters<typeof prisma.payment.findFirst>[0] = {
          where: {
            userId: ownerUserId,
            organizationId,
            date: new Date(r.date),
            amount: r.amount,
            direction: r.direction,
            ...(r.reference
              ? { reference: r.reference }
              : { purpose: r.purpose ?? null }),
          },
        };
        const dup = await prisma.payment.findFirst(dupWhere);
        if (dup) {
          errorsOut.push({
            rowNumber: r.rowNumber,
            message: `Дубликат: платёж от ${r.date} на ${r.amount} ₽${r.reference ? ` (№ ${r.reference})` : ""} уже существует`,
          });
          continue;
        }

        // Защита: OUT-платёж не может иметь allocations
        const allocations = r.direction === "IN" ? (r.allocations ?? []) : [];
        if (r.direction === "OUT" && (r.allocations ?? []).length > 0) {
          errorsOut.push({ rowNumber: r.rowNumber, message: "OUT-платёж не может иметь allocations" });
          continue;
        }

        // Не должно превышать amount
        const allocSum = allocations.reduce((s, a) => s + a.amount, 0);
        if (allocSum > r.amount + EPS) {
          errorsOut.push({ rowNumber: r.rowNumber, message: `Сумма allocations (${allocSum}) больше суммы платежа (${r.amount})` });
          continue;
        }

        const created = await prisma.$transaction((tx) =>
          createPaymentInTx(tx, ownerUserId, {
            organizationId,
            counterpartyId: r.counterpartyId ?? null,
            bankAccountId,
            date: r.date,
            amount: r.amount,
            direction: r.direction,
            method: "BANK",
            purpose: r.purpose ?? null,
            reference: r.reference ?? null,
            allocations,
          }),
        );
        createdPayments.push(created.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Неизвестная ошибка";
        errorsOut.push({ rowNumber: r.rowNumber, message: msg });
      }
    }

    // Drop preview если все строки обработаны (даже с ошибками — сессия больше не нужна)
    if (createdPayments.length + skippedRows.length + errorsOut.length === parsed.data.rows.length) {
      dropPreview(parsed.data.importId);
    }

    return {
      createdPayments,
      skippedRows,
      errors: errorsOut,
    };
  });
}
