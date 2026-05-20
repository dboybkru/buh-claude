import { describe, it, expect } from "vitest";
import { amountToWords } from "./amount-to-words.js";

describe("amountToWords", () => {
  it("целые рубли", () => {
    expect(amountToWords(0)).toBe("Ноль рублей 00 копеек");
    expect(amountToWords(1)).toBe("Один рубль 00 копеек");
    expect(amountToWords(2)).toBe("Два рубля 00 копеек");
    expect(amountToWords(5)).toBe("Пять рублей 00 копеек");
    expect(amountToWords(21)).toBe("Двадцать один рубль 00 копеек");
  });

  it("сотни и тысячи с правильным родом", () => {
    expect(amountToWords(1000)).toBe("Одна тысяча рублей 00 копеек");
    expect(amountToWords(2000)).toBe("Две тысячи рублей 00 копеек");
    expect(amountToWords(5000)).toBe("Пять тысяч рублей 00 копеек");
    expect(amountToWords(12500)).toBe("Двенадцать тысяч пятьсот рублей 00 копеек");
  });

  it("миллионы", () => {
    expect(amountToWords(1_000_000)).toBe("Один миллион рублей 00 копеек");
    expect(amountToWords(2_500_000)).toBe("Два миллиона пятьсот тысяч рублей 00 копеек");
  });

  it("копейки", () => {
    expect(amountToWords(100.5)).toBe("Сто рублей 50 копеек");
    expect(amountToWords(0.99)).toBe("Ноль рублей 99 копеек");
    expect(amountToWords(75000.01)).toBe("Семьдесят пять тысяч рублей 01 копейка");
  });

  it("числа из PDF тестов", () => {
    expect(amountToWords(12200)).toBe("Двенадцать тысяч двести рублей 00 копеек");
    expect(amountToWords(72000)).toBe("Семьдесят две тысячи рублей 00 копеек");
    expect(amountToWords(75000)).toBe("Семьдесят пять тысяч рублей 00 копеек");
    expect(amountToWords(60000)).toBe("Шестьдесят тысяч рублей 00 копеек");
  });

  it("грамматика «копейка» / «копейки» / «копеек»", () => {
    expect(amountToWords(0.21)).toContain("21 копейка");
    expect(amountToWords(0.23)).toContain("23 копейки");
    expect(amountToWords(0.25)).toContain("25 копеек");
    expect(amountToWords(0.11)).toContain("11 копеек");
  });
});
