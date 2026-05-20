import { Prisma, type DocType } from "@prisma/client";
import { prisma } from "./prisma.js";

const DEFAULT_PREFIX: Record<DocType, string> = {
  INVOICE: "СЧ-",
  ACT: "АКТ-",
  UPD: "УПД-",
  WAYBILL: "ТН-",
};

function formatNumber(prefix: string, n: number, year: number): string {
  return `${prefix}${String(n).padStart(4, "0")}/${year}`;
}

/**
 * Выдать следующий номер документа. Транзакционно инкрементирует счётчик
 * (userId, organizationId, docType, year). Если счётчика нет — создаёт.
 *
 * Используется внутри транзакции, в которую обёрнут create документа,
 * чтобы при ошибке создания документа номер не "сгорал" (rollback откатит UPDATE).
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string,
  docType: DocType,
  year: number,
): Promise<string> {
  const counter = await tx.documentNumbering.upsert({
    where: {
      userId_organizationId_docType_year: { userId, organizationId, docType, year },
    },
    create: {
      userId,
      organizationId,
      docType,
      year,
      lastNumber: 1,
      prefix: DEFAULT_PREFIX[docType],
    },
    update: { lastNumber: { increment: 1 } },
  });
  return formatNumber(counter.prefix, counter.lastNumber, year);
}
