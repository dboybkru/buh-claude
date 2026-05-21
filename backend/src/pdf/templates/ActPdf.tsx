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

export interface ActPdfProps {
  number: string;
  date: Date | string;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  seller: PartyInfo;
  buyer: PartyInfo;
  items: ItemRow[];
  sellerSignatory?: string | null;
  buyerSignatory?: string | null;
  notes?: string | null;
  flags: PrintFlags;
  assets: SellerAssets;
  vatLabel?: string | null;
  defaultFooterText?: string | null;
  actNote?: string | null;
}

export function ActPdf(props: ActPdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <HeaderStrip party={props.seller} flags={props.flags} assets={props.assets} />
        <Text style={styles.h1}>Акт № {props.number} от {formatDateLong(props.date)}</Text>
        <Text style={styles.subtitle}>оказанных услуг / выполненных работ</Text>

        <PartyBlock title="Исполнитель" party={props.seller} />
        <PartyBlock title="Заказчик" party={props.buyer} />

        {props.periodStart || props.periodEnd ? (
          <View style={styles.block}>
            <Text style={styles.small}>
              Период оказания услуг: с {formatDate(props.periodStart)} по {formatDate(props.periodEnd)}
            </Text>
          </View>
        ) : null}

        <Text style={[styles.small, { marginBottom: 4 }]}>
          В соответствии с настоящим Актом Исполнитель передал, а Заказчик принял следующие работы (услуги):
        </Text>

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

        <Text style={[styles.small, { marginTop: 12 }]}>
          Работы (услуги) выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.
        </Text>

        <SignaturesWithStamp
          leftLabel="От Исполнителя"
          rightLabel="От Заказчика"
          leftName={props.sellerSignatory}
          rightName={props.buyerSignatory}
          flags={props.flags}
          assets={props.assets}
          showAccountantColumn={true}
        />

        {props.actNote ? <Text style={[styles.small, { marginTop: 12 }]}>{props.actNote}</Text> : null}
        {props.notes ? <Text style={[styles.small, { marginTop: 12 }]}>Примечание: {props.notes}</Text> : null}
        {props.defaultFooterText ? (
          <Text style={styles.footerNote}>{props.defaultFooterText}</Text>
        ) : null}
      </Page>
    </Document>
  );
}
