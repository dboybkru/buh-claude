import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "../lib/styles.js";
import { formatDateLong } from "../lib/format.js";
import {
  HeaderStrip,
  PartyBlock,
  SignaturesWithStamp,
  type PartyInfo,
  type PrintFlags,
  type SellerAssets,
} from "./common.js";

export interface ContractPdfProps {
  number: string;
  date: Date | string;
  seller: PartyInfo;
  buyer: PartyInfo;
  /** Уже отрендеренное тело шаблона (с подстановкой переменных). */
  body: string;
  flags: PrintFlags;
  assets: SellerAssets;
  defaultFooterText?: string | null;
}

export function ContractPdf(props: ContractPdfProps) {
  const paragraphs = props.body.split(/\n{2,}/);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <HeaderStrip party={props.seller} flags={props.flags} assets={props.assets} />

        <Text style={styles.h1}>Договор № {props.number} от {formatDateLong(props.date)}</Text>

        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <PartyBlock title="Сторона 1 (Исполнитель)" party={props.seller} />
          </View>
          <View style={{ flex: 1 }}>
            <PartyBlock title="Сторона 2 (Заказчик)" party={props.buyer} />
          </View>
        </View>

        <View style={{ marginTop: 8 }}>
          {paragraphs.map((para, idx) => (
            <Text key={idx} style={{ marginBottom: 6, fontSize: 10, lineHeight: 1.4 }}>
              {para}
            </Text>
          ))}
        </View>

        <SignaturesWithStamp
          leftLabel={`От ${props.seller.name}`}
          rightLabel={`От ${props.buyer.name}`}
          flags={props.flags}
          assets={props.assets}
          showAccountantColumn={true}
        />

        {props.defaultFooterText ? (
          <Text style={styles.footerNote}>{props.defaultFooterText}</Text>
        ) : null}
      </Page>
    </Document>
  );
}
