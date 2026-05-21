import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty } from "../setup.js";

async function createTemplate(token: string, overrides: Record<string, unknown> = {}) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/api/v1/contract-templates",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      name: "Базовый шаблон",
      description: "Договор оказания услуг",
      content: "Договор № {{contract.number}} от {{contract.date}} с {{counterparty.fullName}} (ИНН {{counterparty.inn}}).",
      isDefault: true,
      ...overrides,
    },
  });
}

describe("Contract templates integration", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  it("создаёт шаблон и обнаруживает переменные", async () => {
    const { token } = await registerUser();
    const r = await createTemplate(token);
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.variables).toContain("contract.number");
    expect(body.variables).toContain("counterparty.inn");
  });

  it("чужой пользователь не видит шаблон", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const r1 = await createTemplate(u1.token);
    const id = r1.json().id;
    const app = await getTestApp();
    const r2 = await app.inject({
      method: "GET",
      url: `/api/v1/contract-templates/${id}`,
      headers: { Authorization: `Bearer ${u2.token}` },
    });
    expect(r2.statusCode).toBe(404);
  });

  it("POST /render-preview подставляет реквизиты", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token, { fullName: "ООО Бета Полное" });
    const tpl = (await createTemplate(token)).json();

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/contract-templates/render-preview",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        templateId: tpl.id,
        organizationId: org.id,
        counterpartyId: cp.id,
        contract: { number: "Д-001/2026", date: "2026-01-15" },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.text).toContain("Д-001/2026");
    expect(body.text).toContain("ООО Бета Полное");
    expect(body.text).toContain("ИНН 7728168971");
    expect(body.missing).toEqual([]);
  });

  it("PATCH обновляет переменные при изменении content", async () => {
    const { token } = await registerUser();
    const tpl = (await createTemplate(token)).json();

    const app = await getTestApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/contract-templates/${tpl.id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { content: "Только {{organization.fullName}}." },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().variables).toEqual(["organization.fullName"]);
  });

  it("GET /variables возвращает whitelist", async () => {
    const { token } = await registerUser();
    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/contract-templates/variables",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.variables.length).toBeGreaterThan(5);
    expect(body.variables.some((v: { key: string }) => v.key === "organization.inn")).toBe(true);
  });
});
