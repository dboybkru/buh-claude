import { describe, it, expect } from "vitest";
import { computePrintWarnings, hasErrors } from "./print-warnings.js";

const orgOk = {
  inn: "7707083893",
  kpp: "770701001",
  legalAddress: "Москва",
  directorName: "Иванов",
  type: "OOO" as const,
  logo: "u/o/logo.png",
  stamp: "u/o/stamp.png",
  signature: "u/o/sig.png",
  bankAccounts: [{ id: "a", isDefault: true }],
};

describe("print-warnings", () => {
  it("счёт без организации возвращает critical error", () => {
    const w = computePrintWarnings({ kind: "invoice", organization: null, counterparty: { inn: "x", name: "x" }, items: [{}] });
    expect(hasErrors(w)).toBe(true);
    expect(w.find((x) => x.code === "org.missing")).toBeDefined();
  });

  it("счёт без позиций → error", () => {
    const w = computePrintWarnings({ kind: "invoice", organization: orgOk, counterparty: { inn: "x", name: "x" }, items: [] });
    expect(w.find((x) => x.code === "items.empty")?.severity).toBe("error");
  });

  it("счёт без банковского счёта (с includeBankDetails) → warning", () => {
    const w = computePrintWarnings({
      kind: "invoice",
      organization: { ...orgOk, bankAccounts: [], printShowBankDetails: true },
      counterparty: { inn: "x", name: "x" },
      items: [{}],
    });
    expect(w.find((x) => x.code === "bank.missing")?.severity).toBe("warning");
  });

  it("если showLogo, но logo нет — warning", () => {
    const w = computePrintWarnings({
      kind: "invoice",
      organization: { ...orgOk, logo: null, printShowLogo: true },
      counterparty: { inn: "x", name: "x" },
      items: [{}],
    });
    expect(w.find((x) => x.code === "org.logo")?.severity).toBe("warning");
  });

  it("если showLogo выключен — нет warning про logo", () => {
    const w = computePrintWarnings({
      kind: "invoice",
      organization: { ...orgOk, logo: null, printShowLogo: false },
      counterparty: { inn: "x", name: "x" },
      items: [{}],
    });
    expect(w.find((x) => x.code === "org.logo")).toBeUndefined();
  });

  it("у юрлица без КПП — warning", () => {
    const w = computePrintWarnings({
      kind: "invoice",
      organization: { ...orgOk, kpp: null, type: "OOO" },
      counterparty: { inn: "x", name: "x" },
      items: [{}],
    });
    expect(w.find((x) => x.code === "org.kpp")?.severity).toBe("warning");
  });

  it("для контракта без предмета — warning", () => {
    const w = computePrintWarnings({
      kind: "contract",
      organization: orgOk,
      counterparty: { inn: "x", name: "x" },
      subject: null,
    });
    expect(w.find((x) => x.code === "contract.subject")).toBeDefined();
  });
});
