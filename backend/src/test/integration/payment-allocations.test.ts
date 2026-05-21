import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty } from "../setup.js";

describe("Payment multi-allocation", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  async function createInvoice(
    token: string,
    orgId: string,
    cpId: string,
    total: number,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: orgId,
        counterpartyId: cpId,
        date: "2026-05-20",
        vatRate: 22,
        vatIncluded: true,
        status: "SENT",
        items: [{ name: "Услуга", unit: "шт", unitCode: "796", quantity: 1, price: total, vatRate: 22 }],
        ...extra,
      },
    });
    if (r.statusCode !== 201) throw new Error(`createInvoice failed: ${r.statusCode} ${r.body}`);
    return r.json().id;
  }

  async function getInvoice(token: string, id: string) {
    const app = await getTestApp();
    const r = await app.inject({ method: "GET", url: `/api/v1/invoices/${id}`, headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  }

  it("один платёж закрывает два счёта", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv1 = await createInvoice(token, org.id, cp.id, 60000);
    const inv2 = await createInvoice(token, org.id, cp.id, 40000);

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        date: "2026-06-01",
        amount: 100000,
        direction: "IN",
        method: "BANK",
        allocations: [
          { invoiceId: inv1, amount: 60000 },
          { invoiceId: inv2, amount: 40000 },
        ],
      },
    });
    expect(r.statusCode).toBe(201);

    const i1 = await getInvoice(token, inv1);
    const i2 = await getInvoice(token, inv2);
    expect(i1.status).toBe("PAID");
    expect(i2.status).toBe("PAID");

    // Payment.get возвращает allocations с invoice details + allocatedAmount/unallocatedAmount
    const pid = r.json().id;
    const p = await app.inject({ method: "GET", url: `/api/v1/payments/${pid}`, headers: { Authorization: `Bearer ${token}` } });
    const body = p.json();
    expect(body.allocations).toHaveLength(2);
    expect(body.allocatedAmount).toBe(100000);
    expect(body.unallocatedAmount).toBe(0);
  });

  it("частичное распределение оставляет аванс", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id, 30000);

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        date: "2026-06-01",
        amount: 50000,
        direction: "IN",
        method: "BANK",
        allocations: [{ invoiceId: inv, amount: 30000 }],
      },
    });
    expect(r.statusCode).toBe(201);

    const i = await getInvoice(token, inv);
    expect(i.status).toBe("PAID");

    const pid = r.json().id;
    const p = await app.inject({ method: "GET", url: `/api/v1/payments/${pid}`, headers: { Authorization: `Bearer ${token}` } });
    const body = p.json();
    expect(body.allocatedAmount).toBe(30000);
    expect(body.unallocatedAmount).toBe(20000);  // нераспределённый аванс
  });

  it("нельзя распределить больше остатка счёта", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id, 10000);

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        date: "2026-06-01",
        amount: 20000,
        direction: "IN",
        method: "BANK",
        allocations: [{ invoiceId: inv, amount: 15000 }],  // больше total счёта
      },
    });
    expect(r.statusCode).toBe(400);
    const i = await getInvoice(token, inv);
    expect(i.status).toBe("SENT");  // статус не изменился, платёж не сохранился
  });

  it("нельзя распределить на счёт другого контрагента", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp1 = await createCounterparty(token);
    const cp2 = await createCounterparty(token, { inn: "500100732259", kpp: undefined, type: "IP", name: "ИП Кузнецов" });
    const inv = await createInvoice(token, org.id, cp1.id, 5000);

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp2.id,  // другой контрагент
        date: "2026-06-01",
        amount: 5000,
        direction: "IN",
        method: "BANK",
        allocations: [{ invoiceId: inv, amount: 5000 }],
      },
    });
    expect(r.statusCode).toBe(400);
  });

  it("изменение allocations пересчитывает старые и новые счета", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const invA = await createInvoice(token, org.id, cp.id, 10000);
    const invB = await createInvoice(token, org.id, cp.id, 10000);

    const app = await getTestApp();
    // создаём платёж, закрывающий invA
    const createR = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        date: "2026-06-01",
        amount: 10000,
        direction: "IN",
        method: "BANK",
        allocations: [{ invoiceId: invA, amount: 10000 }],
      },
    });
    expect(createR.statusCode).toBe(201);
    expect((await getInvoice(token, invA)).status).toBe("PAID");
    expect((await getInvoice(token, invB)).status).toBe("SENT");

    // меняем allocation: перекидываем платёж на invB
    const pid = createR.json().id;
    const patchR = await app.inject({
      method: "PATCH",
      url: `/api/v1/payments/${pid}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        allocations: [{ invoiceId: invB, amount: 10000 }],
      },
    });
    expect(patchR.statusCode).toBe(200);

    const iA = await getInvoice(token, invA);
    const iB = await getInvoice(token, invB);
    expect(iA.status).not.toBe("PAID");
    expect(iA.status).not.toBe("PARTIALLY_PAID");
    expect(iB.status).toBe("PAID");
  });

  it("удаление multi-allocation платежа откатывает статусы всех счетов", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv1 = await createInvoice(token, org.id, cp.id, 5000);
    const inv2 = await createInvoice(token, org.id, cp.id, 5000);
    const inv3 = await createInvoice(token, org.id, cp.id, 5000);

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        date: "2026-06-01",
        amount: 15000,
        direction: "IN",
        method: "BANK",
        allocations: [
          { invoiceId: inv1, amount: 5000 },
          { invoiceId: inv2, amount: 5000 },
          { invoiceId: inv3, amount: 5000 },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    expect((await getInvoice(token, inv1)).status).toBe("PAID");
    expect((await getInvoice(token, inv2)).status).toBe("PAID");
    expect((await getInvoice(token, inv3)).status).toBe("PAID");

    const pid = r.json().id;
    const del = await app.inject({ method: "DELETE", url: `/api/v1/payments/${pid}`, headers: { Authorization: `Bearer ${token}` } });
    expect(del.statusCode).toBe(200);

    for (const id of [inv1, inv2, inv3]) {
      const i = await getInvoice(token, id);
      expect(i.status).not.toBe("PAID");
      expect(i.status).not.toBe("PARTIALLY_PAID");
    }
  });

  it("legacy: invoiceId без allocations превращается в один allocation", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id, 7000);

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/payments",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id,
        counterpartyId: cp.id,
        invoiceId: inv,
        date: "2026-06-01",
        amount: 7000,
        direction: "IN",
        method: "BANK",
      },
    });
    expect(r.statusCode).toBe(201);
    const pid = r.json().id;
    const p = await app.inject({ method: "GET", url: `/api/v1/payments/${pid}`, headers: { Authorization: `Bearer ${token}` } });
    expect(p.json().allocations).toHaveLength(1);
    expect(p.json().allocations[0].invoiceId).toBe(inv);
  });
});
