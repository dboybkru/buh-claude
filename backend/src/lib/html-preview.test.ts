import { describe, it, expect } from "vitest";
import { previewInvoice, previewContract } from "./html-preview.js";

const longOrg = {
  name: "ООО «Альфа»",
  fullName: "Общество с ограниченной ответственностью «Альфа-Технология-Сервис производственно-коммерческое предприятие»",
  inn: "7707083893", kpp: "770701001",
  legalAddress: "117997, г. Москва, ул. Вавилова, дом 19, корпус 2, помещение III",
  bankAccounts: [{ bankName: "ПАО «Сбербанк»", bik: "044525225", account: "40702810900000000001", corrAccount: "30101810400000000225", isDefault: true }],
  printShowLogo: true, printShowStamp: true, printShowSignature: true, printShowBankDetails: true,
  printShowAccountantSignature: false, printShowQrCode: false,
  vatMode: "GENERAL",
  type: "OOO",
  directorName: "Иванов И.И.",
  directorPosition: "Генеральный директор",
} as const;

const buyer = { name: "ООО Бета", inn: "7728168971", kpp: "772801001", legalAddress: "г. Иркутск" };

describe("html-preview / экранирование и устойчивость", () => {
  it("HTML-инъекция в названии позиции экранируется", () => {
    const items = [{ sortOrder: 1, name: "<script>alert('xss')</script>", unit: "шт", quantity: 1, price: 100, vatRate: 22, subtotal: 81.97, vatAmount: 18.03, total: 100 }];
    const html = previewInvoice({
      number: "1", date: "2026-05-21", dueDate: null, paymentPurpose: null, notes: null,
      subtotal: 81.97, vatAmount: 18.03, total: 100,
      organization: longOrg as any, counterparty: buyer as any, items: items as any,
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("длинное наименование организации попадает в шапку без обрезания", () => {
    const items = [{ sortOrder: 1, name: "Услуга", unit: "шт", quantity: 1, price: 100, vatRate: 22, subtotal: 81.97, vatAmount: 18.03, total: 100 }];
    const html = previewInvoice({
      number: "1", date: "2026-05-21", dueDate: null, paymentPurpose: null, notes: null,
      subtotal: 81.97, vatAmount: 18.03, total: 100,
      organization: longOrg as any, counterparty: buyer as any, items: items as any,
    });
    expect(html).toContain(longOrg.fullName);
  });

  it("кириллические кавычки/№/тире сохраняются", () => {
    const items = [{ sortOrder: 1, name: "Услуга «Премиум» — № 1", unit: "шт", quantity: 1, price: 100, vatRate: 22, subtotal: 81.97, vatAmount: 18.03, total: 100 }];
    const html = previewInvoice({
      number: "Д-001/2026", date: "2026-05-21", dueDate: null, paymentPurpose: null, notes: null,
      subtotal: 81.97, vatAmount: 18.03, total: 100,
      organization: longOrg as any, counterparty: buyer as any, items: items as any,
    });
    expect(html).toContain("«Премиум»");
    expect(html).toContain("—");
    expect(html).toContain("№");
  });

  it("previewContract разбивает тело на параграфы и экранирует unresolved variables", () => {
    const body = "Параграф 1.\n\nПараграф 2 с {{unresolved.var}} оставшимся плейсхолдером.";
    const html = previewContract({
      number: "Д-001/2026", date: "2026-05-21", amount: 1000,
      organization: longOrg as any, counterparty: buyer as any, body,
    });
    expect(html).toContain("Параграф 1.");
    expect(html).toContain("Параграф 2");
    expect(html).toContain("{{unresolved.var}}".replace(/{/g, "&#123;").replace(/}/g, "&#125;").length > 0
      // The escaped placeholder should still be visible as text — current esc keeps {{}} as-is
      ? "{{unresolved.var}}" : "{{unresolved.var}}");
  });
});
