import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty } from "../setup.js";

async function createInvoice(token: string, orgId: string, cpId: string) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url: "/api/v1/invoices",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      organizationId: orgId,
      counterpartyId: cpId,
      date: "2026-01-15",
      vatRate: 22,
      vatIncluded: true,
      items: [{ name: "Услуга", unit: "шт", unitCode: "796", quantity: 1, price: 1000, vatRate: 22 }],
    },
  });
}

describe("Print warnings + preview integration", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  it("возвращает warning про отсутствующий банковский счёт и отсутствующий logo", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = (await createInvoice(token, org.id, cp.id)).json();

    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${inv.id}/print-warnings`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const codes = r.json().warnings.map((w: { code: string }) => w.code);
    expect(codes).toContain("bank.missing");
    expect(codes).toContain("org.logo");
  });

  it("HTML preview возвращается с правильным content-type и текстом", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = (await createInvoice(token, org.id, cp.id)).json();

    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${inv.id}/preview`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.body).toContain("Счёт на оплату");
  });

  it("чужой пользователь не получает preview/warnings", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org = await createOrganization(u1.token);
    const cp = await createCounterparty(u1.token);
    const inv = (await createInvoice(u1.token, org.id, cp.id)).json();

    const app = await getTestApp();
    const r1 = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${inv.id}/preview`,
      headers: { Authorization: `Bearer ${u2.token}` },
    });
    expect(r1.statusCode).toBe(404);
    const r2 = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${inv.id}/print-warnings`,
      headers: { Authorization: `Bearer ${u2.token}` },
    });
    expect(r2.statusCode).toBe(404);
  });
});
