import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty } from "../setup.js";

describe("Invoices integration", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  async function setupInvoice(token: string, vatIncluded: boolean, vatRate: number, items: Array<{ name: string; quantity: number; price: number; vatRate: number }>): Promise<{ orgId: string; cpId: string; invoiceId: string; body: any }> {
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        date: "2026-05-20",
        vatRate,
        vatIncluded,
        items: items.map((it) => ({ ...it, unit: "шт", unitCode: "796" })),
      },
    });
    if (r.statusCode !== 201) throw new Error(`create invoice failed: ${r.statusCode} ${r.body}`);
    return { orgId: org.id, cpId: cp.id, invoiceId: r.json().id, body: r.json() };
  }

  it("создаёт счёт с позициями (НДС 22% включён)", async () => {
    const { token } = await registerUser();
    const { body } = await setupInvoice(token, true, 22, [
      { name: "Услуга A", quantity: 1, price: 12200, vatRate: 22 },
    ]);
    expect(body.number).toMatch(/^СЧ-0001\/2026$/);
    expect(Number(body.subtotal)).toBe(10000);
    expect(Number(body.vatAmount)).toBe(2200);
    expect(Number(body.total)).toBe(12200);
  });

  it("корректно считает НДС сверху (22%)", async () => {
    const { token } = await registerUser();
    const { body } = await setupInvoice(token, false, 22, [
      { name: "Услуга", quantity: 5, price: 1000, vatRate: 22 },
    ]);
    expect(Number(body.subtotal)).toBe(5000);
    expect(Number(body.vatAmount)).toBe(1100);
    expect(Number(body.total)).toBe(6100);
  });

  it("микс ставок 22% и 10%", async () => {
    const { token } = await registerUser();
    const { body } = await setupInvoice(token, true, 22, [
      { name: "A", quantity: 3, price: 1500, vatRate: 22 },
      { name: "B", quantity: 2.5, price: 800, vatRate: 10 },
    ]);
    expect(Number(body.total)).toBe(6500);
  });

  it("GET /:id возвращает счёт с позициями", async () => {
    const { token } = await registerUser();
    const { invoiceId } = await setupInvoice(token, true, 22, [{ name: "X", quantity: 1, price: 100, vatRate: 22 }]);
    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoiceId}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().items.length).toBe(1);
  });

  it("чужой счёт возвращает 404", async () => {
    const u1 = await registerUser("u1@example.com");
    const u2 = await registerUser("u2@example.com");
    const { invoiceId } = await setupInvoice(u1.token, true, 22, [{ name: "X", quantity: 1, price: 100, vatRate: 22 }]);
    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${invoiceId}`,
      headers: { Authorization: `Bearer ${u2.token}` },
    });
    expect(r.statusCode).toBe(404);
  });
});
