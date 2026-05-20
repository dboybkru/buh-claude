import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "../lib/styles.js";
import { formatDate, formatDateLong } from "../lib/format.js";
import { amountToWords } from "../lib/amount-to-words.js";
import { PartyBlock, ItemsTable, Totals, SignaturesPair, type PartyInfo, type ItemRow } from "./common.js";

export interface UpdPdfProps {
  number: string;
  date: Date | string;
  functionType: "FULL" | "TRANSFER_ONLY";
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  seller: PartyInfo;
  buyer: PartyInfo;
  items: ItemRow[];
  shipmentDate?: Date | string | null;
  shipmentAddress?: string | null;
  customsDecl?: string | null;
  paymentDocRef?: string | null;
  sellerSignatory?: string | null;
  buyerSignatory?: string | null;
  notes?: string | null;
}

export function UpdPdf(props: UpdPdfProps) {
  const statusLabel = props.functionType === "FULL"
    ? "Статус 1 (счёт-фактура и передаточный документ)"
    : "Статус 2 (только передаточный документ)";

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={[styles.rowSpaced, { marginBottom: 4 }]}>
          <Text style={styles.small}>Универсальный передаточный документ</Text>
          <Text style={[styles.small, styles.bold]}>{statusLabel}</Text>
        </View>

        <Text style={styles.h1}>УПД № {props.number} от {formatDateLong(props.date)}</Text>

        <PartyBlock title="Продавец (грузоотправитель)" party={props.seller} />
        <PartyBlock title="Покупатель (грузополучатель)" party={props.buyer} />

        <View style={[styles.block, styles.row]}>
          {props.shipmentDate ? (
            <Text style={[styles.small, { width: 200 }]}>Дата отгрузки: {formatDate(props.shipmentDate)}</Text>
          ) : null}
          {props.shipmentAddress ? (
            <Text style={[styles.small, { width: 300 }]}>Адрес доставки: {props.shipmentAddress}</Text>
          ) : null}
          {props.paymentDocRef ? (
            <Text style={[styles.small, { width: 200 }]}>К п/п: {props.paymentDocRef}</Text>
          ) : null}
          {props.customsDecl ? (
            <Text style={[styles.small, { width: 200 }]}>Номер ГТД: {props.customsDecl}</Text>
          ) : null}
        </View>

        <ItemsTable items={props.items} />
        <Totals subtotal={props.subtotal} vatAmount={props.vatAmount} total={props.total} />

        <View style={{ marginTop: 8 }}>
          <Text style={styles.small}>
            Сумма прописью: <Text style={styles.bold}>{amountToWords(Number(String(props.total)))}</Text>
          </Text>
        </View>

        <SignaturesPair
          leftLabel="Руководитель организации (продавец)"
          rightLabel="Покупатель (груз получил)"
          leftName={props.sellerSignatory}
          rightName={props.buyerSignatory}
        />

        {props.notes ? <Text style={[styles.small, { marginTop: 12 }]}>Примечание: {props.notes}</Text> : null}
        <Text style={[styles.small, { marginTop: 12, color: "#666" }]}>
          Форма соответствует приказу ФНС России от 19.12.2018 № ММВ-7-15/820@.
        </Text>
      </Page>
    </Document>
  );
}
