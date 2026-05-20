import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "../lib/styles.js";
import { formatAmount, formatDate, formatDateLong } from "../lib/format.js";
import { amountToWords } from "../lib/amount-to-words.js";
import { PartyBlock, ItemsTable, Totals, type PartyInfo, type ItemRow } from "./common.js";

export interface InvoicePdfProps {
  number: string;
  date: Date | string;
  dueDate?: Date | string | null;
  paymentPurpose?: string | null;
  notes?: string | null;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  seller: PartyInfo;
  buyer: PartyInfo;
  items: ItemRow[];
  signatoryDirector?: string | null;
  signatoryAccountant?: string | null;
}

export function InvoicePdf(props: InvoicePdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Реквизиты банка получателя — короткая верхняя плашка */}
        {props.seller.bik && props.seller.account ? (
          <View style={[styles.partyBlock, { marginBottom: 10 }]}>
            <Text style={styles.partyTitle}>Получатель платежа (банковские реквизиты)</Text>
            <Text style={styles.partyName}>{props.seller.fullName ?? props.seller.name}</Text>
            <Text style={styles.small}>ИНН {props.seller.inn}{props.seller.kpp ? `, КПП ${props.seller.kpp}` : ""}</Text>
            <Text style={styles.small}>
              {props.seller.bankName}, БИК {props.seller.bik}, р/с {props.seller.account}
              {props.seller.corrAccount ? `, к/с ${props.seller.corrAccount}` : ""}
            </Text>
          </View>
        ) : null}

        <Text style={styles.h1}>Счёт на оплату № {props.number} от {formatDateLong(props.date)}</Text>
        {props.dueDate ? <Text style={styles.subtitle}>Срок оплаты: {formatDate(props.dueDate)}</Text> : null}

        <PartyBlock title="Поставщик" party={props.seller} />
        <PartyBlock title="Покупатель" party={props.buyer} />

        {props.paymentPurpose ? (
          <View style={styles.block}>
            <Text style={styles.label}>Назначение платежа:</Text>
            <Text>{props.paymentPurpose}</Text>
          </View>
        ) : null}

        <ItemsTable items={props.items} />
        <Totals subtotal={props.subtotal} vatAmount={props.vatAmount} total={props.total} />

        <View style={{ marginTop: 8 }}>
          <Text style={styles.small}>Всего наименований: {props.items.length}</Text>
          <Text style={[styles.small, { marginTop: 4 }]}>
            Сумма прописью: <Text style={styles.bold}>{amountToWords(Number(String(props.total)))}</Text>
          </Text>
        </View>

        <View style={[styles.signatureBlock, { marginTop: 30 }]}>
          <View style={styles.sigCol}>
            <Text style={styles.small}>Руководитель</Text>
            <View style={styles.sigLine} />
            <Text style={[styles.small, { textAlign: "center" }]}>{props.signatoryDirector ?? "(подпись, расшифровка)"}</Text>
          </View>
          <View style={styles.sigCol}>
            <Text style={styles.small}>Главный бухгалтер</Text>
            <View style={styles.sigLine} />
            <Text style={[styles.small, { textAlign: "center" }]}>{props.signatoryAccountant ?? "(подпись, расшифровка)"}</Text>
          </View>
        </View>

        {props.notes ? <Text style={[styles.small, { marginTop: 12 }]}>Примечание: {props.notes}</Text> : null}
        <Text style={[styles.small, { marginTop: 16, color: "#666" }]}>
          Документ сформирован в системе BuhClaude. Без подписи и печати юридической силы не имеет.
        </Text>
      </Page>
    </Document>
  );
}
