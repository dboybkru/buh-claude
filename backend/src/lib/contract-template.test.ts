import { describe, it, expect } from "vitest";
import { extractVariables, renderTemplate, renderContract } from "./contract-template.js";

describe("contract-template / extractVariables", () => {
  it("извлекает уникальные переменные", () => {
    const text = "{{a.b}} и {{c}} и снова {{a.b}}";
    expect(extractVariables(text).sort()).toEqual(["a.b", "c"]);
  });
  it("игнорирует невалидный синтаксис", () => {
    expect(extractVariables("{{ 123abc }} {{x.y}}").sort()).toEqual(["x.y"]);
  });
});

describe("contract-template / renderTemplate", () => {
  it("подставляет значения и оставляет недостающие как {{key}}", () => {
    const r = renderTemplate("Привет, {{counterparty.name}}! Сумма {{contract.amount}}", {
      counterparty: { name: "Бета" },
    });
    expect(r.text).toContain("Привет, Бета!");
    expect(r.text).toContain("{{contract.amount}}");
    expect(r.missing).toContain("contract.amount");
  });
  it("копит unknown для незарегистрированных переменных", () => {
    const r = renderTemplate("Hello {{foo.bar}}", { foo: { bar: "x" } });
    expect(r.text).toBe("Hello x");
    expect(r.unknown).toContain("foo.bar");
  });
  it("не подставляет пустую строку — считает её missing", () => {
    const r = renderTemplate("{{organization.inn}}", { organization: { inn: "" } });
    expect(r.missing).toContain("organization.inn");
    expect(r.text).toBe("{{organization.inn}}");
  });
});

describe("contract-template / renderContract", () => {
  it("строит контекст и подставляет реквизиты", () => {
    const r = renderContract("Договор {{contract.number}} от {{contract.date}} с {{counterparty.fullName}} (ИНН {{counterparty.inn}})", {
      organization: { fullName: "ООО Альфа", name: "Альфа", inn: "7707083893" },
      counterparty: { name: "Бета", fullName: "ООО Бета", inn: "7728168971" },
      contract: { number: "Д-001/2026", date: "2026-01-15" },
    });
    expect(r.text).toBe("Договор Д-001/2026 от 2026-01-15 с ООО Бета (ИНН 7728168971)");
    expect(r.missing).toEqual([]);
  });
  it("подставляет directorName для ИП из entrepreneurName, если directorName пуст", () => {
    const r = renderContract("Подпись: {{directorName}}", {
      organization: { fullName: "ИП Кузнецов", name: "ИП Кузнецов", inn: "500100732259", entrepreneurName: "Кузнецов А.И." },
      counterparty: { name: "X", inn: "7728168971" },
      contract: { number: "1", date: "2026-01-01" },
    });
    expect(r.text).toBe("Подпись: Кузнецов А.И.");
  });
});
