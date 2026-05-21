// Доступ к настройкам печати организации с дефолтами.
// Используется и в PDF, и в HTML-preview, и в print-warnings.

export interface PrintSettings {
  showLogo: boolean;
  showStamp: boolean;
  showSignature: boolean;
  showAccountantSignature: boolean;
  showBankDetails: boolean;
  showQrCode: boolean;
  defaultVatText: string | null;
  defaultPaymentTerms: string | null;
  defaultFooterText: string | null;
  invoiceNote: string | null;
  actNote: string | null;
  updNote: string | null;
  waybillNote: string | null;
  reconciliationNote: string | null;
}

export interface OrgPrintFields {
  printShowLogo: boolean;
  printShowStamp: boolean;
  printShowSignature: boolean;
  printShowAccountantSignature: boolean;
  printShowBankDetails: boolean;
  printShowQrCode: boolean;
  printDefaultVatText: string | null;
  printDefaultPaymentTerms: string | null;
  printDefaultFooterText: string | null;
  printInvoiceNote: string | null;
  printActNote: string | null;
  printUpdNote: string | null;
  printWaybillNote: string | null;
  printReconciliationNote: string | null;
}

export function extractPrintSettings(org: Partial<OrgPrintFields> | null | undefined): PrintSettings {
  return {
    showLogo:                org?.printShowLogo ?? true,
    showStamp:               org?.printShowStamp ?? true,
    showSignature:           org?.printShowSignature ?? true,
    showAccountantSignature: org?.printShowAccountantSignature ?? false,
    showBankDetails:         org?.printShowBankDetails ?? true,
    showQrCode:              org?.printShowQrCode ?? false,
    defaultVatText:          org?.printDefaultVatText ?? null,
    defaultPaymentTerms:     org?.printDefaultPaymentTerms ?? null,
    defaultFooterText:       org?.printDefaultFooterText ?? null,
    invoiceNote:             org?.printInvoiceNote ?? null,
    actNote:                 org?.printActNote ?? null,
    updNote:                 org?.printUpdNote ?? null,
    waybillNote:             org?.printWaybillNote ?? null,
    reconciliationNote:      org?.printReconciliationNote ?? null,
  };
}

/** Удобный текст «Без НДС» / «НДС включён», если в шаблоне нет своего. */
export function defaultVatLabel(vatMode: string | null | undefined, custom?: string | null): string {
  if (custom) return custom;
  if (!vatMode || vatMode === "EXEMPT") return "Без НДС (НК РФ ст. 145)";
  if (vatMode === "USN_5") return "НДС 5% (УСН — без права на вычет)";
  if (vatMode === "USN_7") return "НДС 7% (УСН — без права на вычет)";
  return "НДС по ставкам, указанным в позициях";
}
