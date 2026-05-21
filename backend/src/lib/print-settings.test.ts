import { describe, it, expect } from "vitest";
import { extractPrintSettings, defaultVatLabel } from "./print-settings.js";

describe("print-settings / extractPrintSettings", () => {
  it("отдаёт дефолты, если поля undefined", () => {
    const s = extractPrintSettings(null);
    expect(s.showLogo).toBe(true);
    expect(s.showStamp).toBe(true);
    expect(s.showSignature).toBe(true);
    expect(s.showAccountantSignature).toBe(false);
    expect(s.showBankDetails).toBe(true);
    expect(s.showQrCode).toBe(false);
  });
  it("уважает явно false", () => {
    const s = extractPrintSettings({ printShowLogo: false, printShowStamp: false });
    expect(s.showLogo).toBe(false);
    expect(s.showStamp).toBe(false);
    expect(s.showSignature).toBe(true); // дефолт
  });
  it("отдаёт текстовые поля как есть", () => {
    const s = extractPrintSettings({ printDefaultFooterText: "© Альфа", printInvoiceNote: "оплата 7 дней" });
    expect(s.defaultFooterText).toBe("© Альфа");
    expect(s.invoiceNote).toBe("оплата 7 дней");
  });
});

describe("print-settings / defaultVatLabel", () => {
  it("EXEMPT → без НДС", () => {
    expect(defaultVatLabel("EXEMPT")).toMatch(/Без НДС/);
  });
  it("кастомный текст имеет приоритет", () => {
    expect(defaultVatLabel("GENERAL", "Мой текст")).toBe("Мой текст");
  });
  it("USN_5 / USN_7 → пониженные ставки", () => {
    expect(defaultVatLabel("USN_5")).toMatch(/5%/);
    expect(defaultVatLabel("USN_7")).toMatch(/7%/);
  });
});
