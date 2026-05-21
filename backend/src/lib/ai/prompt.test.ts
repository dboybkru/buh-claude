import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT, FULL_SYSTEM_PROMPT, FEW_SHOT_EXAMPLES } from "./prompt.js";

describe("ai/prompt", () => {
  it("содержит строгое требование возвращать JSON", () => {
    expect(SYSTEM_PROMPT).toMatch(/СТРОГО ОДИН валидный JSON/i);
  });

  it("содержит запрет на выдумывание данных (anti-hallucination)", () => {
    expect(SYSTEM_PROMPT).toMatch(/Никогда не выдумывай/i);
    expect(SYSTEM_PROMPT).toMatch(/ИНН.*КПП/i);
  });

  it("содержит правильные НДС-значения", () => {
    expect(SYSTEM_PROMPT).toMatch(/no_vat/);
    expect(SYSTEM_PROMPT).toMatch(/22/);
  });

  it("содержит ограничение по action.type", () => {
    expect(SYSTEM_PROMPT).toMatch(/create_counterparty/);
    expect(SYSTEM_PROMPT).toMatch(/create_invoice/);
    expect(SYSTEM_PROMPT).toMatch(/Любые другие типы запрещены/i);
  });

  // Sprint 6B
  it("содержит новые action types Sprint 6B", () => {
    expect(SYSTEM_PROMPT).toMatch(/create_act_from_invoice/);
    expect(SYSTEM_PROMPT).toMatch(/create_contract/);
    expect(SYSTEM_PROMPT).toMatch(/analyze_debt/);
  });

  // Sprint 6C
  it("содержит новые action types Sprint 6C", () => {
    expect(SYSTEM_PROMPT).toMatch(/create_payment/);
    expect(SYSTEM_PROMPT).toMatch(/suggest_payment_allocations/);
  });

  it("Sprint 6C: явные правила про OUT без allocations", () => {
    expect(SYSTEM_PROMPT).toMatch(/direction="OUT".*allocations/i);
  });

  it("Sprint 6C: НЕЛЬЗЯ импортировать банк / редактировать платежи", () => {
    expect(SYSTEM_PROMPT).toMatch(/НЕЛЬЗЯ редактировать или удалять/i);
    expect(SYSTEM_PROMPT).toMatch(/НЕЛЬЗЯ импортировать банков/i);
  });

  it("содержит запрет на работу с чужими данными", () => {
    expect(SYSTEM_PROMPT).toMatch(/чужими организациями/i);
  });

  it("FULL_SYSTEM_PROMPT содержит few-shot примеры (включая 6B+6C)", () => {
    expect(FULL_SYSTEM_PROMPT).toContain(SYSTEM_PROMPT);
    expect(FULL_SYSTEM_PROMPT).toContain(FEW_SHOT_EXAMPLES);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 1.*create_counterparty/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 2.*create_invoice/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 3.*missingFields/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 4.*create_act_from_invoice/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 5.*create_contract/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 6.*analyze_debt/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 7.*create_payment/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 8.*create_payment/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 9.*suggest_payment_allocations/s);
  });
});
