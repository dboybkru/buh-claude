import React from "react";
import { View, Text } from "@react-pdf/renderer";
import { styles, itemColWidths } from "../lib/styles.js";
import { formatAmount, formatQuantity } from "../lib/format.js";

export interface PartyInfo {
  name: string;
  fullName?: string | null;
  inn: string;
  kpp?: string | null;
  legalAddress?: string | null;
  bankName?: string | null;
  bik?: string | null;
  account?: string | null;
  corrAccount?: string | null;
}

function fmtParty(p: PartyInfo): string {
  const lines: string[] = [];
  lines.push(p.fullName ?? p.name);
  const codes = [`ИНН ${p.inn}`];
  if (p.kpp) codes.push(`КПП ${p.kpp}`);
  lines.push(codes.join(", "));
  if (p.legalAddress) lines.push(p.legalAddress);
  if (p.bik && p.account) {
    lines.push(
      `${p.bankName ?? ""}, БИК ${p.bik}, р/с ${p.account}${p.corrAccount ? `, к/с ${p.corrAccount}` : ""}`,
    );
  }
  return lines.join(" • ");
}

export function PartyBlock({ title, party }: { title: string; party: PartyInfo }) {
  return (
    <View style={styles.partyBlock}>
      <Text style={styles.partyTitle}>{title}</Text>
      <Text style={styles.partyName}>{party.fullName ?? party.name}</Text>
      <Text style={styles.small}>
        ИНН {party.inn}
        {party.kpp ? `, КПП ${party.kpp}` : ""}
        {party.legalAddress ? `, ${party.legalAddress}` : ""}
      </Text>
      {party.bik && party.account ? (
        <Text style={styles.small}>
          {party.bankName ?? ""}, БИК {party.bik}, р/с {party.account}
          {party.corrAccount ? `, к/с ${party.corrAccount}` : ""}
        </Text>
      ) : null}
    </View>
  );
}

export interface ItemRow {
  sortOrder: number;
  name: string;
  unit: string;
  quantity: unknown;
  price: unknown;
  vatRate: unknown;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
}

function toStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  // Prisma Decimal или другие — у него есть toString
  return String(v);
}

export function ItemsTable({ items, vatLabel }: { items: ItemRow[]; vatLabel?: string }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeaderRow}>
        <Text style={[styles.cellHeader, { width: itemColWidths.num }]}>№</Text>
        <Text style={[styles.cellHeader, { width: itemColWidths.name, textAlign: "left" }]}>Наименование</Text>
        <Text style={[styles.cellHeader, { width: itemColWidths.unit }]}>Ед.</Text>
        <Text style={[styles.cellHeader, { width: itemColWidths.qty }]}>Кол-во</Text>
        <Text style={[styles.cellHeader, { width: itemColWidths.price }]}>Цена</Text>
        <Text style={[styles.cellHeader, { width: itemColWidths.subtotal }]}>Сумма без НДС</Text>
        <Text style={[styles.cellHeader, { width: itemColWidths.vatRate }]}>{vatLabel ?? "НДС, %"}</Text>
        <Text style={[styles.cellHeader, { width: itemColWidths.vatAmount }]}>Сумма НДС</Text>
        <Text style={[styles.cellHeader, { width: itemColWidths.total }]}>Всего с НДС</Text>
      </View>
      {items.map((it, idx) => (
        <View key={idx} style={styles.tableRow}>
          <Text style={[styles.cell, styles.textCenter, { width: itemColWidths.num }]}>{it.sortOrder ?? idx + 1}</Text>
          <Text style={[styles.cell, { width: itemColWidths.name }]}>{it.name}</Text>
          <Text style={[styles.cell, styles.textCenter, { width: itemColWidths.unit }]}>{it.unit}</Text>
          <Text style={[styles.cell, styles.textRight, { width: itemColWidths.qty }]}>{formatQuantity(toStr(it.quantity))}</Text>
          <Text style={[styles.cell, styles.textRight, { width: itemColWidths.price }]}>{formatAmount(toStr(it.price))}</Text>
          <Text style={[styles.cell, styles.textRight, { width: itemColWidths.subtotal }]}>{formatAmount(toStr(it.subtotal))}</Text>
          <Text style={[styles.cell, styles.textCenter, { width: itemColWidths.vatRate }]}>{toStr(it.vatRate)}%</Text>
          <Text style={[styles.cell, styles.textRight, { width: itemColWidths.vatAmount }]}>{formatAmount(toStr(it.vatAmount))}</Text>
          <Text style={[styles.cell, styles.textRight, { width: itemColWidths.total }]}>{formatAmount(toStr(it.total))}</Text>
        </View>
      ))}
    </View>
  );
}

export function Totals({ subtotal, vatAmount, total }: { subtotal: unknown; vatAmount: unknown; total: unknown }) {
  return (
    <View style={{ marginTop: 6 }}>
      <View style={styles.totalsRow}>
        <Text style={styles.totalsLabel}>Итого без НДС:</Text>
        <Text style={styles.totalsValue}>{formatAmount(toStr(subtotal))}</Text>
      </View>
      <View style={styles.totalsRow}>
        <Text style={styles.totalsLabel}>В том числе НДС:</Text>
        <Text style={styles.totalsValue}>{formatAmount(toStr(vatAmount))}</Text>
      </View>
      <View style={styles.totalsRow}>
        <Text style={styles.totalsLabel}>Всего к оплате с НДС:</Text>
        <Text style={styles.totalsValue}>{formatAmount(toStr(total), { withCurrency: true })}</Text>
      </View>
    </View>
  );
}

export function SignaturesPair({ leftLabel, rightLabel, leftName, rightName }: {
  leftLabel: string;
  rightLabel: string;
  leftName?: string | null;
  rightName?: string | null;
}) {
  return (
    <View style={styles.signatureBlock}>
      <View style={styles.sigCol}>
        <Text style={styles.small}>{leftLabel}</Text>
        <View style={styles.sigLine} />
        <Text style={[styles.small, { textAlign: "center" }]}>{leftName ?? "(подпись, расшифровка)"}</Text>
      </View>
      <View style={styles.sigCol}>
        <Text style={styles.small}>{rightLabel}</Text>
        <View style={styles.sigLine} />
        <Text style={[styles.small, { textAlign: "center" }]}>{rightName ?? "(подпись, расшифровка)"}</Text>
      </View>
    </View>
  );
}
