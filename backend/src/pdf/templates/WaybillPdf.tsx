import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "../lib/styles.js";
import { formatDateLong } from "../lib/format.js";
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

const OP_LABEL: Record<string, string> = {
  SALE: "Отгрузка покупателю",
  PURCHASE: "Приём от поставщика",
  RETURN: "Возврат",
  TRANSFER: "Внутреннее перемещение",
};

export interface WaybillPdfProps {
  number: string;
  date: Date | string;
  operationType: "SALE" | "PURCHASE" | "RETURN" | "TRANSFER";
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  seller: PartyInfo;
  buyer: PartyInfo;
  items: ItemRow[];
  shippedBy?: string | null;
  receivedBy?: string | null;
  notes?: string | null;
  flags: PrintFlags;
  assets: SellerAssets;
  vatLabel?: string | null;
  defaultFooterText?: string | null;
  waybillNote?: string | null;
}

export function WaybillPdf(props: WaybillPdfProps) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <HeaderStrip party={props.seller} flags={props.flags} assets={props.assets} />

        <View style={[styles.rowSpaced, { marginBottom: 2 }]}>
          <Text style={styles.small}>Форма ТОРГ-12 • ОКУД 0330212</Text>
          <Text style={[styles.small, styles.bold]}>{OP_LABEL[props.operationType] ?? props.operationType}</Text>
        </View>

        <Text style={styles.h1}>Товарная накладная № {props.number} от {formatDateLong(props.date)}</Text>

        <PartyBlock title="Грузоотправитель" party={props.seller} />
        <PartyBlock title="Грузополучатель" party={props.buyer} />

        <ItemsTable items={props.items} />
        <Totals subtotal={props.subtotal} vatAmount={props.vatAmount} total={props.total} />

        <View style={{ marginTop: 8 }}>
          <Text style={styles.small}>Всего позиций: {props.items.length}</Text>
          {props.vatLabel ? (
            <Text style={[styles.small, { marginTop: 2 }]}>{props.vatLabel}</Text>
          ) : null}
          <Text style={[styles.small, { marginTop: 4 }]}>
            Всего отпущено на сумму: <Text style={styles.bold}>{amountToWords(Number(String(props.total)))}</Text>
          </Text>
        </View>

        <SignaturesWithStamp
          leftLabel="Отпуск груза произвёл"
          rightLabel="Груз получил"
          leftName={props.shippedBy}
          rightName={props.receivedBy}
          flags={props.flags}
          assets={props.assets}
          showAccountantColumn={true}
        />

        {props.waybillNote ? <Text style={[styles.small, { marginTop: 12 }]}>{props.waybillNote}</Text> : null}
        {props.notes ? <Text style={[styles.small, { marginTop: 12 }]}>Примечание: {props.notes}</Text> : null}
        <Text style={styles.footerNote}>
          {props.defaultFooterText ??
            "Форма утверждена постановлением Госкомстата России от 25.12.1998 № 132 (упрощённый MVP)."}
        </Text>
      </Page>
    </Document>
  );
}
