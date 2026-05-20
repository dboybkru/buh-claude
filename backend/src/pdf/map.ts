// Мапперы Prisma-сущностей в props для PDF-шаблонов.
// Получают полный объект документа с `include: { organization: { include: { bankAccounts } }, counterparty, items, bankAccount }`.

import type { PartyInfo, ItemRow } from "./templates/common.js";

type OrgWithAccounts = {
  name: string;
  fullName?: string | null;
  inn: string;
  kpp?: string | null;
  legalAddress?: string | null;
  bankAccounts?: Array<{ bankName: string; bik: string; account: string; corrAccount: string; isDefault: boolean }> | null;
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
