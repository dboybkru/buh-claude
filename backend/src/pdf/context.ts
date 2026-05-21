// Общий helper для роутов: собирает контекст печати из организации.
// Используется PDF-эндпойнтами всех типов документов.

import type { OrgPrintFields } from "../lib/print-settings.js";
import { extractPrintSettings, defaultVatLabel } from "../lib/print-settings.js";
import { mapFlags, mapAssets } from "./map.js";

interface OrgForPdf extends Partial<OrgPrintFields> {
  logo?: string | null;
  stamp?: string | null;
  signature?: string | null;
  vatMode?: string | null;
}

export interface PdfContext {
  flags: ReturnType<typeof mapFlags>;
  assets: ReturnType<typeof mapAssets>;
  vatLabel: string;
  defaultFooterText: string | null;
  invoiceNote: string | null;
  actNote: string | null;
  updNote: string | null;
  waybillNote: string | null;
  reconciliationNote: string | null;
  defaultPaymentTerms: string | null;
  showQrCode: boolean;
}

export function buildPdfContext(org: OrgForPdf, userId: string): PdfContext {
  const s = extractPrintSettings(org);
  return {
    flags: mapFlags(org),
    assets: mapAssets({ ...org, name: "", inn: "" } as any, userId),
    vatLabel: defaultVatLabel(org.vatMode ?? null, s.defaultVatText),
    defaultFooterText: s.defaultFooterText,
    invoiceNote: s.invoiceNote,
    actNote: s.actNote,
    updNote: s.updNote,
    waybillNote: s.waybillNote,
    reconciliationNote: s.reconciliationNote,
    defaultPaymentTerms: s.defaultPaymentTerms,
    showQrCode: s.showQrCode,
  };
}
