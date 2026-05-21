import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty } from "../setup.js";

describe("Counterparty statement", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  async function createInvoice(
    token: string, orgId: string, cpId: string, total: number, date: string, dueDate?: string,
  ): Promise<string> {
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: orgId, counterpartyId: cpId,
        date, dueDate, vatRate: 22, vatIncluded: true, status: "SENT",
        items: [{ name: "Услуга", unit: "шт", unitCode: "796", quantity: 1, price: total, vatRate: 22 }],
      },
    });
    if (r.statusCode !== 201) throw new Error(`createInvoice failed: ${r.statusCode} ${r.body}`);
    return r.json().id;
  }

  async function createPayment(
    token: string, orgId: string, cpId: string, amount: number, date: string,
    allocations?: Array<{ invoiceId: string; amount: number }>,
  ): Promise<string> {
    const app = await getTestApp();
    const payload: Record<string, unknown> = {
      organizationId: orgId, counterpartyId: cpId,
      date, amount, direction: "IN", method: "BANK",
    };
    if (allocations) payload.allocations = allocations;
    const r = await app.inject({
      method: "POST", url: "/api/v1/payments",
      headers: { Authorization: `Bearer ${token}` }, payload,
    });
    if (r.statusCode !== 201) throw new Error(`createPayment failed: ${r.statusCode} ${r.body}`);
    return r.json().id;
  }

  it("баланс: 100k выставлено, 60k оплачено, 20k аванс → debt 40k, advance 20k", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);

    const inv1 = await createInvoice(token, org.id, cp.id, 60000, "2026-05-10");
    const inv2 = await createInvoice(token, org.id, cp.id, 40000, "2026-05-12");
    // полностью оплачивает inv1 + аванс 20k
    await createPayment(token, org.id, cp.id, 80000, "2026-05-20", [{ invoiceId: inv1, amount: 60000 }]);

    const app = await getTestApp();
    const r = await app.inject({
      method: "GET", url: `/api/v1/counterparties/${cp.id}/statement`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.totals.invoiced).toBe(100000);
    expect(s.totals.paid).toBe(80000);
    expect(s.totals.allocated).toBe(60000);
    expect(s.totals.unallocatedAdvance).toBe(20000);
    expect(s.totals.debt).toBe(40000);   // 100000 − 60000

    expect(s.invoices).toHaveLength(2);
    const paidInv = s.invoices.find((i: { id: string }) => i.id === inv1);
    expect(paidInv.balance).toBe(0);
    const unpaidInv = s.invoices.find((i: { id: string }) => i.id === inv2);
    expect(unpaidInv.balance).toBe(40000);
    expect(s.payments).toHaveLength(1);
    expect(s.payments[0].unallocatedAmount).toBe(20000);
  });

  it("просроченный долг: счёт с dueDate в прошлом и без оплаты", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    // dueDate в прошлом
    await createInvoice(token, org.id, cp.id, 5000, "2026-01-10", "2026-01-20");
    // не оплачен → overdueDebt = 5000
    const app = await getTestApp();
    const r = await app.inject({
      method: "GET", url: `/api/v1/counterparties/${cp.id}/statement`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.json().totals.overdueDebt).toBe(5000);
  });

  it("Cancelled-счёт не учитывается в invoiced/debt", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);

    const inv = await createInvoice(token, org.id, cp.id, 10000, "2026-05-10");
    // отменим
    const app = await getTestApp();
    await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${inv}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { status: "CANCELLED" },
    });

    const r = await app.inject({
      method: "GET", url: `/api/v1/counterparties/${cp.id}/statement`,
      headers: { Authorization: `Bearer ${token}` },
    });
    const s = r.json();
    expect(s.totals.invoiced).toBe(0);
    expect(s.totals.debt).toBe(0);
  });
});
