import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "../lib/styles.js";
import { formatDate, formatDateLong } from "../lib/format.js";
import { amountToWords } from "../lib/amount-to-words.js";
import {
  PartyBlock,
  ItemsTable,
  Totals,
  HeaderStrip,
  SignaturesWithStamp,
  type PartyInfo,
  type ItemRow,
  type PrintFlags,
  type SellerAssets,
} from "./common.js";

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
  flags: PrintFlags;
  assets: SellerAssets;
  /** Текст «Без НДС / НДС по ставкам» — из print settings или авто. */
  vatLabel?: string | null;
  defaultPaymentTerms?: string | null;
  defaultFooterText?: string | null;
  invoiceNote?: string | null;
  showQrCode?: boolean;
}

export function InvoicePdf(props: InvoicePdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <HeaderStrip party={props.seller} flags={props.flags} assets={props.assets} hideBankLine />

        {/* Реквизиты банка получателя — короткая верхняя плашка */}
        {props.flags.showBankDetails && props.seller.bik && props.seller.account ? (
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

        {props.defaultPaymentTerms ? (
          <View style={styles.block}>
            <Text style={styles.label}>Условия оплаты:</Text>
            <Text style={styles.small}>{props.defaultPaymentTerms}</Text>
          </View>
        ) : null}

        <ItemsTable items={props.items} />
        <Totals subtotal={props.subtotal} vatAmount={props.vatAmount} total={props.total} />

        <View style={{ marginTop: 8 }}>
          <Text style={styles.small}>Всего наименований: {props.items.length}</Text>
          {props.vatLabel ? (
            <Text style={[styles.small, { marginTop: 2 }]}>{props.vatLabel}</Text>
          ) : null}
          <Text style={[styles.small, { marginTop: 4 }]}>
            Сумма прописью: <Text style={styles.bold}>{amountToWords(Number(String(props.total)))}</Text>
          </Text>
        </View>

        <SignaturesWithStamp
          leftLabel="Руководитель"
          rightLabel="Главный бухгалтер"
          leftName={props.signatoryDirector}
          rightName={props.signatoryAccountant}
          flags={props.flags}
          assets={props.assets}
          showAccountantColumn={props.flags.showAccountantSignature}
        />

        {props.showQrCode ? (
          <Text style={[styles.small, { marginTop: 8, color: "#666" }]}>
            QR-код для оплаты — TODO (MVP).
          </Text>
        ) : null}

        {props.invoiceNote ? (
          <Text style={[styles.small, { marginTop: 12 }]}>{props.invoiceNote}</Text>
        ) : null}
        {props.notes ? <Text style={[styles.small, { marginTop: 12 }]}>Примечание: {props.notes}</Text> : null}
        <Text style={styles.footerNote}>
          {props.defaultFooterText ??
            "Документ сформирован в системе BuhClaude. Без подписи и печати юридической силы не имеет."}
        </Text>
      </Page>
    </Document>
  );
}
