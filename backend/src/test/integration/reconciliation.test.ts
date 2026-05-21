import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty } from "../setup.js";

describe("Reconciliation (акт сверки)", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  async function createInvoice(
    token: string, orgId: string, cpId: string, total: number, date: string,
  ): Promise<string> {
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: orgId, counterpartyId: cpId,
        date, vatRate: 22, vatIncluded: true, status: "SENT",
        items: [{ name: "Услуга", unit: "шт", unitCode: "796", quantity: 1, price: total, vatRate: 22 }],
      },
    });
    if (r.statusCode !== 201) throw new Error(`createInvoice failed: ${r.statusCode} ${r.body}`);
    return r.json().id;
  }

  async function createAct(token: string, orgId: string, cpId: string, total: number, date: string, invoiceId?: string): Promise<string> {
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/acts",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: orgId, counterpartyId: cpId,
        invoiceId: invoiceId ?? undefined,
        date, vatRate: 22, vatIncluded: true, status: "SIGNED",
        items: [{ name: "Услуга", unit: "шт", unitCode: "796", quantity: 1, price: total, vatRate: 22 }],
      },
    });
    if (r.statusCode !== 201) throw new Error(`createAct failed: ${r.statusCode} ${r.body}`);
    return r.json().id;
  }

  async function createPayment(
    token: string, orgId: string, cpId: string, amount: number, date: string,
    allocations?: Array<{ invoiceId: string; amount: number }>,
  ) {
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

  async function preview(token: string, orgId: string, cpId: string, from: string, to: string) {
    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/reconciliations/preview?organizationId=${orgId}&counterpartyId=${cpId}&periodFrom=${from}&periodTo=${to}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.json();
  }

  it("один счёт + частичная оплата → closingBalance = остаток долга", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id, 10000, "2026-05-10");
    await createPayment(token, org.id, cp.id, 3000, "2026-05-15", [{ invoiceId: inv, amount: 3000 }]);

    const p = await preview(token, org.id, cp.id, "2026-05-01", "2026-05-31");
    expect(p.openingBalance).toBe(0);
    expect(p.totalDebit).toBe(10000);
    expect(p.totalCredit).toBe(3000);
    expect(p.closingBalance).toBe(7000);
  });

  it("несколько счетов и один multi-allocation платёж покрывают всё", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv1 = await createInvoice(token, org.id, cp.id, 4000, "2026-05-05");
    const inv2 = await createInvoice(token, org.id, cp.id, 6000, "2026-05-06");
    await createPayment(token, org.id, cp.id, 10000, "2026-05-20", [
      { invoiceId: inv1, amount: 4000 }, { invoiceId: inv2, amount: 6000 },
    ]);

    const p = await preview(token, org.id, cp.id, "2026-05-01", "2026-05-31");
    expect(p.totalDebit).toBe(10000);
    expect(p.totalCredit).toBe(10000);
    expect(p.closingBalance).toBe(0);
  });

  it("аванс: платёж без счёта даёт отрицательное (переплата) closingBalance", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    await createPayment(token, org.id, cp.id, 5000, "2026-05-10");  // без allocations
    const p = await preview(token, org.id, cp.id, "2026-05-01", "2026-05-31");
    expect(p.totalDebit).toBe(0);
    expect(p.totalCredit).toBe(5000);
    expect(p.closingBalance).toBe(-5000);  // переплата контрагента
  });

  it("акт на основании счёта не удваивает задолженность", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id, 8000, "2026-05-10");
    await createAct(token, org.id, cp.id, 8000, "2026-05-15", inv);  // акт на основании счёта

    const p = await preview(token, org.id, cp.id, "2026-05-01", "2026-05-31");
    expect(p.totalDebit).toBe(8000);  // только счёт, без акта
    expect(p.totalCredit).toBe(0);
    expect(p.closingBalance).toBe(8000);
  });
});
