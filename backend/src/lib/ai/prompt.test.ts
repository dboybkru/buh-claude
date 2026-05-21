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

  it("содержит запрет на работу с чужими данными", () => {
    expect(SYSTEM_PROMPT).toMatch(/чужими организациями/i);
  });

  it("FULL_SYSTEM_PROMPT содержит few-shot примеры", () => {
    expect(FULL_SYSTEM_PROMPT).toContain(SYSTEM_PROMPT);
    expect(FULL_SYSTEM_PROMPT).toContain(FEW_SHOT_EXAMPLES);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 1.*create_counterparty/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 2.*create_invoice/s);
    expect(FULL_SYSTEM_PROMPT).toMatch(/Пример 3.*missingFields/s);
  });
});
