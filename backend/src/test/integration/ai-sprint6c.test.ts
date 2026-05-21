// Sprint 6C integration: create_payment + suggest_payment_allocations.
// Через Mock provider, без внешней сети. Финансовое ядро (payments-service)
// переиспользуется — здесь проверяем только AI-обёртку и safety-инварианты.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty, getTestPrisma,
} from "../setup.js";

async function saveMockSettings(token: string) {
  const app = await getTestApp();
  return app.inject({
    method: "PUT", url: "/api/v1/ai/settings",
    headers: { Authorization: `Bearer ${token}` },
    payload: { provider: "mock", baseUrl: "mock://local", model: "mock-gpt-base", temperature: 0.2, maxTokens: 2000, isEnabled: true },
  });
}

async function createInvoice(token: string, orgId: string, cpId: string, opts?: { amount?: number; dueDate?: string; date?: string }) {
  const app = await getTestApp();
  const r = await app.inject({
    method: "POST", url: "/api/v1/invoices",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      organizationId: orgId, counterpartyId: cpId,
      date: opts?.date ?? "2026-05-01",
      dueDate: opts?.dueDate ?? "2026-05-10",
      vatRate: 22, vatIncluded: true,
      items: [{ name: "Услуга", unit: "шт", unitCode: "796", quantity: 1, price: opts?.amount ?? 10000, vatRate: 22 }],
    },
  });
  return r.json();
}

describe("AI Sprint 6C integration (Mock provider)", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  /* -------------------- create_payment IN с allocations -------------------- */

  it("create_payment IN с allocations закрывает счёт + audit log", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id, { amount: 10000 });
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай входящий платёж на 10000 по счёту", organizationId: org.id, scope: "organization" },
    });
    expect(chat.statusCode).toBe(200);
    const planId = chat.json().actionPlanId;

    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().errors).toEqual([]);
    expect(confirm.json().applied.length).toBe(1);
    expect(confirm.json().applied[0].targetType).toBe("payment");

    const prisma = await getTestPrisma();
    const pay = await prisma.payment.findFirst({ where: { userId } });
    expect(pay).toBeTruthy();
    expect(Number(pay!.amount)).toBe(10000);
    expect(pay!.direction).toBe("IN");

    const allocs = await prisma.paymentAllocation.findMany({ where: { paymentId: pay!.id } });
    expect(allocs.length).toBe(1);
    expect(allocs[0]!.invoiceId).toBe(inv.id);

    // Счёт стал PAID
    const invAfter = await prisma.invoice.findUnique({ where: { id: inv.id } });
    expect(invAfter?.status).toBe("PAID");

    // Audit log
    const audit = await prisma.aiAuditLog.findFirst({ where: { userId, actionType: "create_payment" } });
    expect(audit?.targetId).toBe(pay!.id);
    expect(audit?.targetType).toBe("payment");
  });

  /* -------------------- create_payment IN без allocations → аванс -------------------- */

  it("create_payment IN без allocations — аванс (без allocations в БД)", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    // Сценарий: счёта в контексте нет → mock создаёт IN payment без allocations
    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай входящий платёж от контрагента на 5000", organizationId: org.id, scope: "organization" },
    });
    expect(chat.statusCode).toBe(200);
    const planId = chat.json().actionPlanId;

    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(confirm.json().errors).toEqual([]);
    expect(confirm.json().applied.length).toBe(1);

    const prisma = await getTestPrisma();
    const pay = await prisma.payment.findFirst({ where: { userId } });
    expect(Number(pay!.amount)).toBe(5000);
    const allocs = await prisma.paymentAllocation.findMany({ where: { paymentId: pay!.id } });
    expect(allocs.length).toBe(0);
    void cp;
  });

  /* -------------------- create_payment OUT — без allocations -------------------- */

  it("create_payment OUT создаётся без allocations", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    await createCounterparty(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай исходящий платёж поставщику 25000", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;

    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(confirm.json().errors).toEqual([]);

    const prisma = await getTestPrisma();
    const pay = await prisma.payment.findFirst({ where: { userId } });
    expect(pay?.direction).toBe("OUT");
    expect(Number(pay!.amount)).toBe(25000);
    const allocs = await prisma.paymentAllocation.findMany({ where: { paymentId: pay!.id } });
    expect(allocs.length).toBe(0);
  });

  /* -------------------- safety: OUT + allocations отклоняется -------------------- */

  it("OUT с allocations отклоняется executor-ом (через хакнутый plan)", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id);
    const app = await getTestApp();

    const prisma = await getTestPrisma();
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId, organizationId: org.id, status: "DRAFT", message: "evil",
        planJson: {
          intent: "create_payment", summary: "evil", confidence: 0.9, missingFields: [], warnings: [],
          actions: [{
            id: "a1", type: "create_payment",
            payload: {
              organizationId: org.id, counterpartyId: cp.id, date: "2026-05-22",
              amount: 1000, direction: "OUT", method: "BANK",
              allocations: [{ invoiceId: inv.id, amount: 1000 }],
            },
          }],
        },
      },
    });

    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${plan.id}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(r.json().applied).toEqual([]);
    expect(r.json().errors.length).toBe(1);
    expect(r.json().errors[0].error).toMatch(/OUT.*allocations/i);
  });

  /* -------------------- safety: переплата отклоняется -------------------- */

  it("Переплата (allocations > остатка) отклоняется", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id, { amount: 1000 });
    const app = await getTestApp();

    const prisma = await getTestPrisma();
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId, organizationId: org.id, status: "DRAFT", message: "overpay",
        planJson: {
          intent: "create_payment", summary: "overpay", confidence: 0.9, missingFields: [], warnings: [],
          actions: [{
            id: "a1", type: "create_payment",
            payload: {
              organizationId: org.id, counterpartyId: cp.id, date: "2026-05-22",
              amount: 5000, direction: "IN", method: "BANK",
              allocations: [{ invoiceId: inv.id, amount: 5000 }], // больше остатка (1000)
            },
          }],
        },
      },
    });

    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${plan.id}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(r.json().applied).toEqual([]);
    expect(r.json().errors.length).toBe(1);
    expect(r.json().errors[0].error).toMatch(/распределить|остаток/i);
  });

  /* -------------------- safety: cross-organization invoice отклоняется -------------------- */

  it("AI executor отклоняет allocation на счёт чужой организации", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org1 = await createOrganization(u1.token);
    const org2 = await createOrganization(u2.token, { inn: "7728168971" });
    const cp1 = await createCounterparty(u1.token);
    const cp2 = await createCounterparty(u2.token, { inn: "500100732259", kpp: undefined, type: "IP" });
    const inv1 = await createInvoice(u1.token, org1.id, cp1.id);

    const prisma = await getTestPrisma();
    // u2 пытается применить план с allocation на invoice u1
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId: u2.userId, organizationId: org2.id, status: "DRAFT", message: "evil",
        planJson: {
          intent: "create_payment", summary: "evil", confidence: 0.9, missingFields: [], warnings: [],
          actions: [{
            id: "a1", type: "create_payment",
            payload: {
              organizationId: org2.id, counterpartyId: cp2.id, date: "2026-05-22",
              amount: 1000, direction: "IN",
              allocations: [{ invoiceId: inv1.id, amount: 1000 }],
            },
          }],
        },
      },
    });

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${plan.id}/confirm`,
      headers: { Authorization: `Bearer ${u2.token}` }, payload: {},
    });
    expect(r.json().applied).toEqual([]);
    expect(r.json().errors.length).toBe(1);
  });

  /* -------------------- suggest_payment_allocations: read-only FIFO -------------------- */

  it("suggest_payment_allocations распределяет FIFO + advance amount, не пишет Payment", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    // Два неоплаченных счёта: первый старый и просроченный, второй новый
    const inv1 = await createInvoice(token, org.id, cp.id, { amount: 3000, date: "2026-04-01", dueDate: "2026-04-15" });
    const inv2 = await createInvoice(token, org.id, cp.id, { amount: 5000, date: "2026-05-01", dueDate: "2026-05-15" });
    void inv1; void inv2;
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Распредели платёж 10000 по счетам контрагента", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;
    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(confirm.json().errors).toEqual([]);
    const result = confirm.json().applied[0].result;
    expect(result.amount).toBe(10000);
    expect(result.allocatedAmount).toBe(8000); // 3000 + 5000
    expect(result.advanceAmount).toBe(2000);
    expect(result.allocations.length).toBe(2);
    // FIFO: первый — более ранний/просроченный
    expect(result.allocations[0].invoiceDate).toBe("2026-04-01");
    expect(result.allocations[1].invoiceDate).toBe("2026-05-01");

    // Read-only invariant: Payment не создан
    const prisma = await getTestPrisma();
    const payments = await prisma.payment.findMany({ where: { userId } });
    expect(payments.length).toBe(0);
    const allocs = await prisma.paymentAllocation.findMany({});
    expect(allocs.length).toBe(0);

    // Audit log с targetId=null
    const audit = await prisma.aiAuditLog.findFirst({ where: { userId, actionType: "suggest_payment_allocations" } });
    expect(audit?.targetType).toBe("analysis");
    expect(audit?.targetId).toBeNull();
  });

  it("suggest_payment_allocations: нет неоплаченных счетов → весь amount в аванс", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Распредели платёж 5000 по счетам контрагента", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;
    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    const result = confirm.json().applied[0].result;
    expect(result.allocatedAmount).toBe(0);
    expect(result.advanceAmount).toBe(5000);
    expect(result.allocations.length).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    void cp;
  });

  it("suggest_payment_allocations с чужим counterpartyId → executor отклоняет", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org2 = await createOrganization(u2.token);
    const cp1 = await createCounterparty(u1.token);
    const prisma = await getTestPrisma();
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId: u2.userId, organizationId: org2.id, status: "DRAFT", message: "evil",
        planJson: {
          intent: "suggest_payment_allocations", summary: "evil", confidence: 0.9, missingFields: [], warnings: [],
          actions: [{
            id: "a1", type: "suggest_payment_allocations",
            payload: { organizationId: org2.id, counterpartyId: cp1.id, amount: 1000 },
          }],
        },
      },
    });
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${plan.id}/confirm`,
      headers: { Authorization: `Bearer ${u2.token}` }, payload: {},
    });
    expect(r.json().applied).toEqual([]);
    expect(r.json().errors.length).toBe(1);
    expect(r.json().errors[0].error).toMatch(/Контрагент/i);
  });

  /* -------------------- audit endpoint -------------------- */

  it("audit-log endpoint показывает payment + analysis типы", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    await createInvoice(token, org.id, cp.id, { amount: 2000 });
    await saveMockSettings(token);
    const app = await getTestApp();

    // 1. create_payment
    const chat1 = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай входящий платёж на 2000 по счёту", organizationId: org.id, scope: "organization" },
    });
    await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${chat1.json().actionPlanId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });

    // 2. suggest_payment_allocations
    const chat2 = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Распредели платёж 1000 по счетам контрагента", organizationId: org.id, scope: "organization" },
    });
    await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${chat2.json().actionPlanId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });

    const log = await app.inject({
      method: "GET", url: `/api/v1/ai/audit-log?organizationId=${org.id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(log.statusCode).toBe(200);
    const items = log.json().items;
    expect(items.length).toBeGreaterThanOrEqual(2);
    const types = items.map((i: { actionType: string }) => i.actionType);
    expect(types).toContain("create_payment");
    expect(types).toContain("suggest_payment_allocations");
    // payloadJson не утекает
    for (const item of items) {
      expect(item).not.toHaveProperty("payloadJson");
    }
  });
});
