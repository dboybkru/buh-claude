import { describe, it, expect } from "vitest";
import { MockAIProvider } from "./providers/mock.js";
import { parseActionPlan } from "./action-plan.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const CP = "22222222-2222-4222-8222-222222222222";

const ctxSystem = (orgId: string | null, cpId: string | null, today = "2026-05-21") =>
  `Контекст: organizationId="${orgId}"; counterpartyId="${cpId}"; today="${today}"`;

describe("MockAIProvider", () => {
  const provider = new MockAIProvider();

  it("listModels возвращает фиксированный список", async () => {
    const m = await provider.listModels();
    expect(m.length).toBeGreaterThan(0);
    expect(m).toEqual(MockAIProvider.models());
  });

  it("«создай контрагента ООО Ромашка ИНН 7707083893» → create_counterparty action", async () => {
    const r = await provider.chat([
      { role: "system", content: ctxSystem(ORG, null) },
      { role: "user", content: "Создай контрагента ООО Ромашка ИНН 7707083893" },
    ]);
    const p = parseActionPlan(r.text);
    expect(p.ok).toBe(true);
    expect(p.plan?.actions.length).toBe(1);
    expect(p.plan?.actions[0]?.type).toBe("create_counterparty");
    if (p.plan?.actions[0]?.type === "create_counterparty") {
      expect(p.plan.actions[0].payload.inn).toBe("7707083893");
      expect(p.plan.actions[0].payload.name).toMatch(/Ромашка/);
      expect(p.plan.actions[0].payload.organizationId).toBe(ORG);
    }
  });

  it("«создай счёт ... 10000 без НДС» → create_invoice с vatRate=no_vat", async () => {
    const r = await provider.chat([
      { role: "system", content: ctxSystem(ORG, CP) },
      { role: "user", content: "Создай счёт за консультацию 10000 рублей без НДС" },
    ]);
    const p = parseActionPlan(r.text);
    expect(p.ok).toBe(true);
    expect(p.plan?.actions.length).toBe(1);
    if (p.plan?.actions[0]?.type === "create_invoice") {
      expect(p.plan.actions[0].payload.organizationId).toBe(ORG);
      expect(p.plan.actions[0].payload.counterpartyId).toBe(CP);
      expect(p.plan.actions[0].payload.items[0]?.price).toBe(10000);
      expect(p.plan.actions[0].payload.items[0]?.vatRate).toBe("no_vat");
    }
  });

  it("«не хватает данных» → план с missingFields, actions=[]", async () => {
    const r = await provider.chat([
      { role: "system", content: ctxSystem(ORG, CP) },
      { role: "user", content: "не хватает данных" },
    ]);
    const p = parseActionPlan(r.text);
    expect(p.ok).toBe(true);
    expect(p.plan?.actions.length).toBe(0);
    expect(p.plan?.missingFields.length).toBeGreaterThan(0);
  });

  it("без organizationId — план без actions, missingFields содержит organizationId", async () => {
    const r = await provider.chat([
      { role: "system", content: ctxSystem(null, null) },
      { role: "user", content: "Создай контрагента ООО Х ИНН 7707083893" },
    ]);
    const p = parseActionPlan(r.text);
    expect(p.ok).toBe(true);
    expect(p.plan?.actions.length).toBe(0);
    expect(p.plan?.missingFields).toContain("organizationId");
  });

  it("неизвестный запрос → информационный план", async () => {
    const r = await provider.chat([
      { role: "system", content: ctxSystem(ORG, CP) },
      { role: "user", content: "Расскажи анекдот" },
    ]);
    const p = parseActionPlan(r.text);
    expect(p.ok).toBe(true);
    expect(p.plan?.actions.length).toBe(0);
    expect(p.plan?.warnings.length).toBeGreaterThan(0);
  });
});
