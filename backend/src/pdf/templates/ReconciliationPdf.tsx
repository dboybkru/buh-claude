import React from "react";
import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "../lib/styles.js";
import { formatAmount, formatDate, formatDateLong } from "../lib/format.js";
import { PartyBlock, SignaturesPair, type PartyInfo } from "./common.js";

export interface ReconciliationLineRow {
  date: string;
  description: string;
  debit: number;
  credit: number;
}

export interface ReconciliationPdfProps {
  number: string;
  date: Date | string;
  periodFrom: Date | string;
  periodTo: Date | string;
  seller: PartyInfo;
  buyer: PartyInfo;
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  lines: ReconciliationLineRow[];
  notes?: string | null;
}

export function ReconciliationPdf(props: ReconciliationPdfProps) {
  const closingPositive = props.closingBalance >= 0;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.h1}>Акт сверки взаимных расчётов № {props.number}</Text>
        <Text style={styles.subtitle}>
          от {formatDateLong(props.date)} за период {formatDate(props.periodFrom)} — {formatDate(props.periodTo)}
        </Text>

        <PartyBlock title="Организация (наша)" party={props.seller} />
        <PartyBlock title="Контрагент" party={props.buyer} />

        <View style={{ marginBottom: 8 }}>
          <Text style={styles.small}>
            Стороны произвели сверку взаимных расчётов и подтверждают следующие данные:
          </Text>
        </View>

        {/* Шапка таблицы */}
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.cellHeader, { width: 70 }]}>Дата</Text>
            <Text style={[styles.cellHeader, { flexGrow: 1, textAlign: "left" }]}>Документ / основание</Text>
            <Text style={[styles.cellHeader, { width: 90 }]}>Дебет</Text>
            <Text style={[styles.cellHeader, { width: 90 }]}>Кредит</Text>
          </View>

          {/* Открывающее сальдо */}
          <View style={styles.tableRow}>
            <Text style={[styles.cell, styles.textCenter, { width: 70 }]}>{formatDate(props.periodFrom)}</Text>
            <Text style={[styles.cell, { flexGrow: 1 }]}>Сальдо на начало периода</Text>
            <Text style={[styles.cell, styles.textRight, { width: 90 }]}>
              {props.openingBalance > 0 ? formatAmount(props.openingBalance) : ""}
            </Text>
            <Text style={[styles.cell, styles.textRight, { width: 90 }]}>
              {props.openingBalance < 0 ? formatAmount(-props.openingBalance) : ""}
            </Text>
          </View>

          {/* Движения */}
          {props.lines.map((line, idx) => (
            <View key={idx} style={styles.tableRow}>
              <Text style={[styles.cell, styles.textCenter, { width: 70 }]}>{formatDate(line.date)}</Text>
              <Text style={[styles.cell, { flexGrow: 1 }]}>{line.description}</Text>
              <Text style={[styles.cell, styles.textRight, { width: 90 }]}>
                {line.debit > 0 ? formatAmount(line.debit) : ""}
              </Text>
              <Text style={[styles.cell, styles.textRight, { width: 90 }]}>
                {line.credit > 0 ? formatAmount(line.credit) : ""}
              </Text>
            </View>
          ))}

          {/* Итоги по оборотам */}
          <View style={[styles.tableRow, { backgroundColor: "#f5f5f5" }]}>
            <Text style={[styles.cell, { width: 70 }]} />
            <Text style={[styles.cell, styles.bold, { flexGrow: 1 }]}>Обороты за период</Text>
            <Text style={[styles.cell, styles.textRight, styles.bold, { width: 90 }]}>{formatAmount(props.totalDebit)}</Text>
            <Text style={[styles.cell, styles.textRight, styles.bold, { width: 90 }]}>{formatAmount(props.totalCredit)}</Text>
          </View>

          {/* Закрывающее сальдо */}
          <View style={[styles.tableRow, { backgroundColor: "#e8e8e8" }]}>
            <Text style={[styles.cell, styles.textCenter, { width: 70 }]}>{formatDate(props.periodTo)}</Text>
            <Text style={[styles.cell, styles.bold, { flexGrow: 1 }]}>Сальдо на конец периода</Text>
            <Text style={[styles.cell, styles.textRight, styles.bold, { width: 90 }]}>
              {closingPositive ? formatAmount(props.closingBalance) : ""}
            </Text>
            <Text style={[styles.cell, styles.textRight, styles.bold, { width: 90 }]}>
              {!closingPositive ? formatAmount(-props.closingBalance) : ""}
            </Text>
          </View>
        </View>

        {/* Резюме */}
        <View style={{ marginTop: 10 }}>
          {props.closingBalance > 0 ? (
            <Text style={styles.small}>
              По данным {props.seller.name} задолженность контрагента {props.buyer.name} на конец периода составляет{" "}
              <Text style={styles.bold}>{formatAmount(props.closingBalance, { withCurrency: true })}</Text>.
            </Text>
          ) : props.closingBalance < 0 ? (
            <Text style={styles.small}>
              По данным {props.seller.name} переплата контрагента {props.buyer.name} на конец периода составляет{" "}
              <Text style={styles.bold}>{formatAmount(-props.closingBalance, { withCurrency: true })}</Text>.
            </Text>
          ) : (
            <Text style={styles.small}>
              По данным {props.seller.name} взаимные расчёты на конец периода полностью закрыты.
            </Text>
          )}
        </View>

        <SignaturesPair
          leftLabel={`От ${props.seller.name}`}
          rightLabel={`От ${props.buyer.name}`}
        />

        {props.notes ? (
          <Text style={[styles.small, { marginTop: 12 }]}>Примечание: {props.notes}</Text>
        ) : null}

        <Text style={[styles.small, { marginTop: 12, color: "#666" }]}>
          Сальдо положительное → задолженность контрагента. Сальдо отрицательное → переплата контрагента.
        </Text>
      </Page>
    </Document>
  );
}
