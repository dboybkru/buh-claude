import { describe, it, expect } from "vitest";
import { isValidInn, isValidOgrn } from "./validators.js";

describe("isValidInn", () => {
  it("принимает валидные 10-значные ИНН юрлица", () => {
    expect(isValidInn("7707083893")).toBe(true);   // Сбербанк
    expect(isValidInn("7728168971")).toBe(true);   // Газпром
  });

  it("принимает валидный 12-значный ИНН ИП", () => {
    expect(isValidInn("500100732259")).toBe(true);
  });

  it("отвергает ИНН с битой контрольной суммой", () => {
    expect(isValidInn("7707083892")).toBe(false);
    expect(isValidInn("1234567890")).toBe(false);
  });

  it("отвергает ИНН неверной длины и с буквами", () => {
    expect(isValidInn("")).toBe(false);
    expect(isValidInn("770708")).toBe(false);
    expect(isValidInn("770708389333")).toBe(false);  // 12 цифр, но с битой к/с
    expect(isValidInn("ABCD123456")).toBe(false);
  });
});

describe("isValidOgrn", () => {
  it("принимает валидный 13-значный ОГРН (юрлицо)", () => {
    expect(isValidOgrn("1027700132195")).toBe(true);  // Сбербанк
  });

  it("отвергает ОГРН с битой контрольной суммой", () => {
    expect(isValidOgrn("1027700132196")).toBe(false);
  });

  it("отвергает ОГРН неверной длины", () => {
    expect(isValidOgrn("")).toBe(false);
    expect(isValidOgrn("123")).toBe(false);
  });
});
