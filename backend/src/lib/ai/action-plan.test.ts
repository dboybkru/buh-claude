import { describe, it, expect } from "vitest";
import { parseActionPlan, selectApprovedActions } from "./action-plan.js";

const ORG = "11111111-1111-4111-8111-111111111111";

describe("ai/action-plan / parseActionPlan", () => {
  it("invalid JSON → ok=false", () => {
    const r = parseActionPlan("not a json");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid JSON/);
  });

  it("unknown action type → ok=false с понятным сообщением", () => {
    const r = parseActionPlan(JSON.stringify({
      intent: "x", summary: "x",
      actions: [{ id: "a", type: "delete_invoice", payload: {} }],
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown action type/);
  });

  it("schema mismatch → ok=false с путём", () => {
    const r = parseActionPlan(JSON.stringify({
      intent: "x", summary: "x",
      actions: [{ id: "a", type: "create_counterparty", payload: { organizationId: "not-uuid", name: "x", inn: "7707083893" } }],
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("валидный план — ok=true и default-поля", () => {
    const r = parseActionPlan(JSON.stringify({
      intent: "create_counterparty",
      summary: "create",
      actions: [{ id: "a", type: "create_counterparty", payload: { organizationId: ORG, name: "ООО Х", inn: "7707083893" } }],
    }));
    expect(r.ok).toBe(true);
    expect(r.plan?.missingFields).toEqual([]);
    expect(r.plan?.warnings).toEqual([]);
    expect(r.plan?.confidence).toBe(0.5);
  });
});

describe("ai/action-plan / selectApprovedActions", () => {
  it("если approvedActionIds не передан — все actions approved", () => {
    const plan = {
      intent: "x", summary: "x", confidence: 0.5, missingFields: [], warnings: [],
      actions: [
        { id: "a1", type: "create_counterparty" as const, payload: { organizationId: ORG, name: "x", inn: "7707083893" } },
        { id: "a2", type: "create_counterparty" as const, payload: { organizationId: ORG, name: "y", inn: "7728168971" } },
      ],
    };
    const r = selectApprovedActions(plan);
    expect(r.approved.length).toBe(2);
    expect(r.skipped.length).toBe(0);
  });

  it("если approvedActionIds передан — фильтрует", () => {
    const plan = {
      intent: "x", summary: "x", confidence: 0.5, missingFields: [], warnings: [],
      actions: [
        { id: "a1", type: "create_counterparty" as const, payload: { organizationId: ORG, name: "x", inn: "7707083893" } },
        { id: "a2", type: "create_counterparty" as const, payload: { organizationId: ORG, name: "y", inn: "7728168971" } },
      ],
    };
    const r = selectApprovedActions(plan, ["a1"]);
    expect(r.approved.map((a) => a.id)).toEqual(["a1"]);
    expect(r.skipped.map((s) => s.id)).toEqual(["a2"]);
  });
});
