// Мапперы Prisma-сущностей в props для PDF-шаблонов.
// Получают полный объект документа с `include: { organization: { include: { bankAccounts } }, counterparty, items, bankAccount }`.

import type { PartyInfo, ItemRow, SellerAssets, PrintFlags } from "./templates/common.js";
import { extractPrintSettings, type OrgPrintFields } from "../lib/print-settings.js";
import { resolveSafeAssetPath } from "../lib/uploads.js";

type OrgWithAccounts = {
  name: string;
  fullName?: string | null;
  inn: string;
  kpp?: string | null;
  legalAddress?: string | null;
  bankAccounts?: Array<{ id?: string; bankName: string; bik: string; account: string; corrAccount: string; isDefault: boolean }> | null;
};

type OrgFull = OrgWithAccounts & Partial<OrgPrintFields> & {
  userId?: string;
  logo?: string | null;
  stamp?: string | null;
  signature?: string | null;
};

type Counterparty = {
  name: string;
  fullName?: string | null;
  inn: string;
  kpp?: string | null;
  legalAddress?: string | null;
};

type Item = {
  sortOrder: number;
  name: string;
  unit: string;
  quantity: unknown;
  price: unknown;
  vatRate: unknown;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
};

export function mapSeller(org: OrgWithAccounts, preferredBankAccountId?: string | null): PartyInfo {
  const accounts = org.bankAccounts ?? [];
  const chosen =
    (preferredBankAccountId ? accounts.find((a) => (a as { id?: string }).id === preferredBankAccountId) : undefined) ??
    accounts.find((a) => a.isDefault) ??
    accounts[0];
  return {
    name: org.name,
    fullName: org.fullName ?? null,
    inn: org.inn,
    kpp: org.kpp ?? null,
    legalAddress: org.legalAddress ?? null,
    bankName: chosen?.bankName ?? null,
    bik: chosen?.bik ?? null,
    account: chosen?.account ?? null,
    corrAccount: chosen?.corrAccount ?? null,
  };
}

export function mapBuyer(cp: Counterparty): PartyInfo {
  return {
    name: cp.name,
    fullName: cp.fullName ?? null,
    inn: cp.inn,
    kpp: cp.kpp ?? null,
    legalAddress: cp.legalAddress ?? null,
    bankName: null,
    bik: null,
    account: null,
    corrAccount: null,
  };
}

export function mapItems(items: Item[]): ItemRow[] {
  return items.map((it) => ({
    sortOrder: it.sortOrder,
    name: it.name,
    unit: it.unit,
    quantity: it.quantity,
    price: it.price,
    vatRate: it.vatRate,
    subtotal: it.subtotal,
    vatAmount: it.vatAmount,
    total: it.total,
  }));
}

/** Print settings → флаги для шаблона. */
export function mapFlags(org: Partial<OrgPrintFields> | null | undefined): PrintFlags {
  const s = extractPrintSettings(org ?? undefined);
  return {
    showLogo: s.showLogo,
    showStamp: s.showStamp,
    showSignature: s.showSignature,
    showAccountantSignature: s.showAccountantSignature,
    showBankDetails: s.showBankDetails,
  };
}

/** Абсолютные пути к файлам подписи/печати/логотипа (для @react-pdf Image src). */
export function mapAssets(org: OrgFull, userId: string): SellerAssets {
  return {
    logoPath: org.logo ? resolveSafeAssetPath(userId, org.logo) : null,
    stampPath: org.stamp ? resolveSafeAssetPath(userId, org.stamp) : null,
    signaturePath: org.signature ? resolveSafeAssetPath(userId, org.signature) : null,
  };
}
