import { describe, it, expect } from "vitest";
import {
  actionPlanSchema,
  actionSchema,
  vatRateSchema,
  vatRateToNumber,
  ALLOWED_ACTION_TYPES,
} from "./schemas.js";

describe("ai/schemas / actionPlanSchema", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const CP = "22222222-2222-4222-8222-222222222222";

  it("валидный план create_counterparty проходит", () => {
    const r = actionPlanSchema.safeParse({
      intent: "create_counterparty",
      summary: "Создать контрагента",
      confidence: 0.9,
      missingFields: [],
      warnings: [],
      actions: [
        { id: "a1", type: "create_counterparty", payload: { organizationId: ORG, name: "ООО Тест", inn: "7707083893" } },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("валидный план create_invoice с vatRate=no_vat", () => {
    const r = actionPlanSchema.safeParse({
      intent: "create_invoice",
      summary: "Счёт без НДС",
      confidence: 0.85,
      missingFields: [],
      warnings: [],
      actions: [{
        id: "a1", type: "create_invoice",
        payload: { organizationId: ORG, counterpartyId: CP, date: "2026-05-21",
          items: [{ name: "Услуга", unit: "шт", quantity: 1, price: 1000, vatRate: "no_vat" }] },
      }],
    });
    expect(r.success).toBe(true);
  });

  it("неизвестный action type отклоняется discriminated union", () => {
    const r = actionPlanSchema.safeParse({
      intent: "x", summary: "x", actions: [{ id: "a", type: "delete_invoice", payload: {} }],
    });
    expect(r.success).toBe(false);
  });

  it("create_invoice с пустыми items отклоняется", () => {
    const r = actionSchema.safeParse({ id: "a", type: "create_invoice", payload: {
      organizationId: ORG, counterpartyId: CP, date: "2026-05-21", items: [],
    } });
    expect(r.success).toBe(false);
  });

  it("create_invoice с quantity 0 отклоняется", () => {
    const r = actionSchema.safeParse({ id: "a", type: "create_invoice", payload: {
      organizationId: ORG, counterpartyId: CP, date: "2026-05-21",
      items: [{ name: "x", unit: "шт", quantity: 0, price: 1, vatRate: 22 }],
    } });
    expect(r.success).toBe(false);
  });

  it("create_counterparty с битым ИНН отклоняется", () => {
    const r = actionSchema.safeParse({ id: "a", type: "create_counterparty", payload: {
      organizationId: ORG, name: "x", inn: "abc",
    } });
    expect(r.success).toBe(false);
  });

  it("vatRate допускает только дискретные значения", () => {
    expect(vatRateSchema.safeParse("no_vat").success).toBe(true);
    expect(vatRateSchema.safeParse(0).success).toBe(true);
    expect(vatRateSchema.safeParse(10).success).toBe(true);
    expect(vatRateSchema.safeParse(20).success).toBe(true);
    expect(vatRateSchema.safeParse(22).success).toBe(true);
    expect(vatRateSchema.safeParse(5).success).toBe(false);
    expect(vatRateSchema.safeParse(7).success).toBe(false);
    expect(vatRateSchema.safeParse("0").success).toBe(false);
  });

  it("vatRateToNumber преобразует no_vat в 0", () => {
    expect(vatRateToNumber("no_vat")).toBe(0);
    expect(vatRateToNumber(22)).toBe(22);
  });

  it("ALLOWED_ACTION_TYPES (Sprint 6C) содержит ровно 7 значений", () => {
    expect(ALLOWED_ACTION_TYPES).toEqual([
      "create_counterparty",
      "create_invoice",
      "create_act_from_invoice",
      "create_contract",
      "analyze_debt",
      "create_payment",
      "suggest_payment_allocations",
    ]);
  });

  // Sprint 6C schemas
  it("create_payment: amount > 0, direction IN|OUT, allocations опциональны", () => {
    const ok = actionSchema.safeParse({
      id: "a", type: "create_payment",
      payload: { organizationId: ORG, counterpartyId: CP, date: "2026-05-22", amount: 1000, direction: "IN", method: "BANK" },
    });
    expect(ok.success).toBe(true);

    const withAllocs = actionSchema.safeParse({
      id: "a", type: "create_payment",
      payload: {
        organizationId: ORG, counterpartyId: CP, date: "2026-05-22", amount: 1000, direction: "IN",
        allocations: [{ invoiceId: "33333333-3333-4333-8333-333333333333", amount: 1000 }],
      },
    });
    expect(withAllocs.success).toBe(true);

    const zeroAmount = actionSchema.safeParse({
      id: "a", type: "create_payment",
      payload: { organizationId: ORG, counterpartyId: CP, date: "2026-05-22", amount: 0, direction: "IN" },
    });
    expect(zeroAmount.success).toBe(false);

    const badDirection = actionSchema.safeParse({
      id: "a", type: "create_payment",
      payload: { organizationId: ORG, counterpartyId: CP, date: "2026-05-22", amount: 1000, direction: "MAYBE" },
    });
    expect(badDirection.success).toBe(false);
  });

  it("suggest_payment_allocations: amount > 0, counterpartyId обязателен", () => {
    const ok = actionSchema.safeParse({
      id: "a", type: "suggest_payment_allocations",
      payload: { organizationId: ORG, counterpartyId: CP, amount: 50000 },
    });
    expect(ok.success).toBe(true);

    const noCp = actionSchema.safeParse({
      id: "a", type: "suggest_payment_allocations",
      payload: { organizationId: ORG, amount: 50000 },
    });
    expect(noCp.success).toBe(false);

    const zero = actionSchema.safeParse({
      id: "a", type: "suggest_payment_allocations",
      payload: { organizationId: ORG, counterpartyId: CP, amount: 0 },
    });
    expect(zero.success).toBe(false);
  });

  // Sprint 6B schemas
  it("create_act_from_invoice требует organizationId + invoiceId", () => {
    const ok = actionSchema.safeParse({
      id: "a", type: "create_act_from_invoice",
      payload: { organizationId: ORG, invoiceId: "33333333-3333-4333-8333-333333333333", date: "2026-05-21" },
    });
    expect(ok.success).toBe(true);

    const missingInvoice = actionSchema.safeParse({
      id: "a", type: "create_act_from_invoice", payload: { organizationId: ORG },
    });
    expect(missingInvoice.success).toBe(false);
  });

  it("create_contract требует subject", () => {
    const ok = actionSchema.safeParse({
      id: "a", type: "create_contract",
      payload: { organizationId: ORG, counterpartyId: CP, subject: "Оказание услуг" },
    });
    expect(ok.success).toBe(true);

    const noSubject = actionSchema.safeParse({
      id: "a", type: "create_contract", payload: { organizationId: ORG, counterpartyId: CP },
    });
    expect(noSubject.success).toBe(false);

    const emptySubject = actionSchema.safeParse({
      id: "a", type: "create_contract", payload: { organizationId: ORG, counterpartyId: CP, subject: "" },
    });
    expect(emptySubject.success).toBe(false);
  });

  it("analyze_debt — organizationId обязателен, counterpartyId опциональный", () => {
    const onlyOrg = actionSchema.safeParse({
      id: "a", type: "analyze_debt", payload: { organizationId: ORG },
    });
    expect(onlyOrg.success).toBe(true);

    const withCp = actionSchema.safeParse({
      id: "a", type: "analyze_debt", payload: { organizationId: ORG, counterpartyId: CP, asOfDate: "2026-05-21" },
    });
    expect(withCp.success).toBe(true);

    const noOrg = actionSchema.safeParse({
      id: "a", type: "analyze_debt", payload: {},
    });
    expect(noOrg.success).toBe(false);
  });
});
