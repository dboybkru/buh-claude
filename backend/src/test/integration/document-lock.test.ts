import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty } from "../setup.js";

describe("Document lock integration", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  it("DRAFT счёт можно редактировать", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const app = await getTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        date: "2026-05-20",
        vatRate: 22,
        vatIncluded: true,
        items: [{ name: "X", unit: "шт", unitCode: "796", quantity: 1, price: 100, vatRate: 22 }],
      },
    });
    const id = created.json().id;
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { notes: "обновили" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("PAID счёт нельзя редактировать (409 Locked)", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const app = await getTestApp();
    const inv = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        date: "2026-05-20",
        status: "PAID",
        vatRate: 22,
        vatIncluded: true,
        items: [{ name: "X", unit: "шт", unitCode: "796", quantity: 1, price: 100, vatRate: 22 }],
      },
    });
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${inv.json().id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { notes: "пытаюсь править" },
    });
    expect(r.statusCode).toBe(409);
  });

  it("SIGNED акт нельзя редактировать", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const app = await getTestApp();
    const act = await app.inject({
      method: "POST",
      url: "/api/v1/acts",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        date: "2026-05-20",
        status: "SIGNED",
        vatRate: 22,
        vatIncluded: true,
        items: [{ name: "Услуга", unit: "ч", unitCode: "356", quantity: 1, price: 1000, vatRate: 22 }],
      },
    });
    const r = await app.inject({
      method: "PATCH",
      url: `/api/v1/acts/${act.json().id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { notes: "x" },
    });
    expect(r.statusCode).toBe(409);
  });
});
