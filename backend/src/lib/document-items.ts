import { z } from "zod";
import type { Prisma, DocType } from "@prisma/client";
import { calcItem, sumDocument, type ItemAmounts } from "./recalc.js";

export const itemInputSchema = z.object({
  nomenclatureId: z.string().uuid().optional().nullable(),
  sortOrder: z.coerce.number().int().min(1).default(1),
  name: z.string().min(1).max(500),
  unit: z.string().default("шт"),
  unitCode: z.string().default("796"),
  quantity: z.coerce.number().positive(),
  price: z.coerce.number().min(0),
  vatRate: z.coerce.number().min(0).max(99.99).default(20),
  countryCode: z.string().optional().nullable(),
  countryName: z.string().optional().nullable(),
  customsDecl: z.string().optional().nullable(),
});

export type ItemInputParsed = z.infer<typeof itemInputSchema>;

export interface PreparedItem extends ItemInputParsed {
  amounts: ItemAmounts;
}

export function prepareItems(items: ItemInputParsed[], vatIncluded: boolean): {
  prepared: PreparedItem[];
  totals: { subtotal: string; vatAmount: string; total: string };
} {
  const prepared = items.map((it) => ({ ...it, amounts: calcItem(it, vatIncluded) }));
  const totals = sumDocument(prepared.map((p) => p.amounts));
  return {
    prepared,
    totals: {
      subtotal: totals.subtotal.toFixed(2),
      vatAmount: totals.vatAmount.toFixed(2),
      total: totals.total.toFixed(2),
    },
  };
}

/**
 * Возвращает create-payload для DocumentItem, привязанный к конкретному типу документа.
 * Один из {invoiceId, actId, updId, waybillId} будет заполнен в зависимости от docType.
 */
export function itemCreateData(
  item: PreparedItem,
  userId: string,
  docType: DocType,
  docId: string,
): Prisma.DocumentItemCreateManyInput {
  const fk =
    docType === "INVOICE" ? { invoiceId: docId } :
    docType === "ACT"     ? { actId: docId } :
    docType === "UPD"     ? { updId: docId } :
                            { waybillId: docId };

  return {
    userId,
    documentType: docType,
    nomenclatureId: item.nomenclatureId ?? null,
    sortOrder: item.sortOrder,
    name: item.name,
    unit: item.unit,
    unitCode: item.unitCode,
    quantity: item.quantity,
    price: item.price,
    vatRate: item.vatRate,
    subtotal: item.amounts.subtotal.toNumber(),
    vatAmount: item.amounts.vatAmount.toNumber(),
    total: item.amounts.total.toNumber(),
    countryCode: item.countryCode ?? null,
    countryName: item.countryName ?? null,
    customsDecl: item.customsDecl ?? null,
    ...fk,
  };
}
