import { describe, it, expect } from "vitest";
import { calcItem, sumDocument } from "./recalc.js";

describe("calcItem — НДС включён в цену", () => {
  it("базовый случай: 1×12200, НДС 22% включён", () => {
    const r = calcItem({ quantity: 1, price: 12200, vatRate: 22 }, true);
    expect(r.total.toNumber()).toBe(12200);
    expect(r.vatAmount.toNumber()).toBe(2200);
    expect(r.subtotal.toNumber()).toBe(10000);
  });

  it("НДС 0% — vatAmount=0, subtotal=total", () => {
    const r = calcItem({ quantity: 5, price: 1000, vatRate: 0 }, true);
    expect(r.total.toNumber()).toBe(5000);
    expect(r.vatAmount.toNumber()).toBe(0);
    expect(r.subtotal.toNumber()).toBe(5000);
  });

  it("УСН 5%: 1×10500 → 500 НДС, 10000 без НДС", () => {
    const r = calcItem({ quantity: 1, price: 10500, vatRate: 5 }, true);
    expect(r.total.toNumber()).toBe(10500);
    expect(r.vatAmount.toNumber()).toBe(500);
    expect(r.subtotal.toNumber()).toBe(10000);
  });
});

describe("calcItem — НДС сверху", () => {
  it("базовый: 5×1000, НДС 22% сверху → 5000 subtotal + 1100 НДС = 6100", () => {
    const r = calcItem({ quantity: 5, price: 1000, vatRate: 22 }, false);
    expect(r.subtotal.toNumber()).toBe(5000);
    expect(r.vatAmount.toNumber()).toBe(1100);
    expect(r.total.toNumber()).toBe(6100);
  });

  it("НДС 10% сверху: 2.5×800 = 2000 → 200 НДС → 2200", () => {
    const r = calcItem({ quantity: 2.5, price: 800, vatRate: 10 }, false);
    expect(r.subtotal.toNumber()).toBe(2000);
    expect(r.vatAmount.toNumber()).toBe(200);
    expect(r.total.toNumber()).toBe(2200);
  });
});

describe("sumDocument — агрегация", () => {
  it("суммирует несколько позиций", () => {
    const items = [
      calcItem({ quantity: 1, price: 12200, vatRate: 22 }, true),
      calcItem({ quantity: 5, price: 1000, vatRate: 22 }, false),
    ];
    const totals = sumDocument(items);
    // 10000+5000=15000 subtotal; 2200+1100=3300 НДС; 12200+6100=18300 total
    expect(totals.subtotal.toNumber()).toBe(15000);
    expect(totals.vatAmount.toNumber()).toBe(3300);
    expect(totals.total.toNumber()).toBe(18300);
  });

  it("работает с микс-ставками", () => {
    const items = [
      calcItem({ quantity: 3, price: 1500, vatRate: 22 }, true),   // total=4500
      calcItem({ quantity: 2.5, price: 800, vatRate: 10 }, true),  // total=2000
    ];
    const totals = sumDocument(items);
    expect(totals.total.toNumber()).toBe(6500);
  });
});
