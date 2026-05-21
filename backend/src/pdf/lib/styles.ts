import { StyleSheet } from "@react-pdf/renderer";

export const colors = {
  border: "#000000",
  borderLight: "#666666",
  text: "#000000",
  muted: "#444444",
};

export const styles = StyleSheet.create({
  page: {
    fontFamily: "PTSans",
    fontSize: 9,
    padding: 28,
    color: colors.text,
  },
  h1: {
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 4,
  },
  h2: {
    fontSize: 11,
    fontWeight: "bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 10,
    textAlign: "center",
    marginBottom: 10,
  },
  row: { flexDirection: "row" },
  rowSpaced: { flexDirection: "row", justifyContent: "space-between" },
  label: { fontSize: 9, color: colors.muted },
  bold: { fontWeight: "bold" },
  small: { fontSize: 8 },
  block: { marginBottom: 8 },
  hr: { borderBottomWidth: 1, borderBottomColor: colors.border, marginVertical: 6 },

  // Шапка "Поставщик/Покупатель"
  partyBlock: { marginBottom: 6, padding: 4, borderWidth: 0.5, borderColor: colors.borderLight },
  partyTitle: { fontSize: 9, color: colors.muted, marginBottom: 2 },
  partyName: { fontSize: 10, fontWeight: "bold" },

  // Таблица позиций
  table: {
    flexDirection: "column",
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: colors.border,
    marginBottom: 6,
  },
  tableRow: { flexDirection: "row" },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#eee",
  },
  cell: {
    padding: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    fontSize: 8,
  },
  cellHeader: {
    padding: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    fontSize: 8,
    fontWeight: "bold",
    textAlign: "center",
  },
  textRight: { textAlign: "right" },
  textCenter: { textAlign: "center" },

  totalsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 2,
  },
  totalsLabel: { width: 220, textAlign: "right", paddingRight: 6 },
  totalsValue: { width: 110, textAlign: "right", fontWeight: "bold" },

  signatureBlock: {
    marginTop: 16,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sigCol: { width: "48%" },
  sigLine: {
    borderBottomWidth: 0.5,
    borderColor: colors.border,
    marginTop: 18,
    marginBottom: 2,
  },
  // Шапка с логотипом + реквизитами организации (Sprint 5)
  headerStrip: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
    gap: 10,
  },
  headerLogo: {
    width: 64,
    height: 64,
    objectFit: "contain",
  },
  headerOrgBlock: { flex: 1 },
  headerOrgName: { fontSize: 11, fontWeight: "bold" },
  // Подпись + печать на одной строке (Sprint 5)
  sigImageBox: {
    position: "relative",
    height: 40,
    marginTop: 4,
  },
  sigImage: {
    position: "absolute",
    left: 0,
    bottom: 4,
    width: 110,
    height: 36,
    objectFit: "contain",
  },
  stampImage: {
    position: "absolute",
    right: 0,
    bottom: -6,
    width: 80,
    height: 80,
    objectFit: "contain",
    opacity: 0.85,
  },
  footerNote: { fontSize: 8, color: "#666", marginTop: 8 },
});

// Ширины колонок таблицы позиций (доли от 100%): #, наименование, ед, кол-во, цена, без НДС, НДС%, НДС, всего
export const itemColWidths = {
  num: 20,
  name: 220,
  unit: 28,
  qty: 36,
  price: 50,
  subtotal: 60,
  vatRate: 30,
  vatAmount: 55,
  total: 60,
};
