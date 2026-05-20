import { describe, it, expect } from "vitest";
import { formatAmount, formatDate, formatDateLong, formatQuantity } from "./format.js";

describe("formatAmount", () => {
  it("форматирует с неразрывным пробелом и запятой", () => {
    expect(formatAmount(0)).toBe("0,00");
    expect(formatAmount(100)).toBe("100,00");
    expect(formatAmount(1234)).toBe("1 234,00");
    expect(formatAmount(1234567.89)).toBe("1 234 567,89");
  });

  it("с валютой добавляет ₽", () => {
    expect(formatAmount(100, { withCurrency: true })).toBe("100,00 ₽");
  });

  it("принимает строки", () => {
    expect(formatAmount("75000")).toBe("75 000,00");
    expect(formatAmount("75000.5")).toBe("75 000,50");
  });

  it("возвращает пустую строку для null/undefined", () => {
    expect(formatAmount(null)).toBe("");
    expect(formatAmount(undefined)).toBe("");
  });
});

describe("formatDate", () => {
  it("ISO → дд.мм.гггг", () => {
    expect(formatDate("2026-05-20")).toBe("20.05.2026");
    expect(formatDate(new Date("2026-01-01"))).toBe("01.01.2026");
  });

  it("null/empty", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
  });
});

describe("formatDateLong", () => {
  it("«дд» месяц гггг г.", () => {
    expect(formatDateLong("2026-05-20")).toBe("«20» мая 2026 г.");
    expect(formatDateLong("2026-01-31")).toBe("«31» января 2026 г.");
  });
});

describe("formatQuantity", () => {
  it("без хвостовых нулей, запятая как разделитель", () => {
    expect(formatQuantity(3)).toBe("3");
    expect(formatQuantity(2.5)).toBe("2,5");
    expect(formatQuantity(2.500)).toBe("2,5");
    expect(formatQuantity(1.123)).toBe("1,123");
  });
});
