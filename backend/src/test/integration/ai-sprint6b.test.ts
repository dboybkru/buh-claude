// Sprint 6B integration: новые AI actions (create_act_from_invoice, create_contract, analyze_debt).
// Все тесты — через Mock provider, без внешней сети.

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

async function createInvoice(token: string, orgId: string, cpId: string, opts?: { status?: string; amount?: number }) {
  const app = await getTestApp();
  const r = await app.inject({
    method: "POST", url: "/api/v1/invoices",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      organizationId: orgId, counterpartyId: cpId,
      date: "2026-05-01", dueDate: "2026-05-10",
      vatRate: 22, vatIncluded: true,
      items: [{ name: "Услуга", unit: "шт", unitCode: "796", quantity: 1, price: opts?.amount ?? 10000, vatRate: 22 }],
      ...(opts?.status ? { status: opts.status } : {}),
    },
  });
  return r.json();
}

describe("AI Sprint 6B integration (Mock provider)", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  /* -------------------- create_act_from_invoice -------------------- */

  it("create_act_from_invoice: создаёт акт по счёту и пишет audit log", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id);
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай акт по последнему счёту", organizationId: org.id, scope: "organization" },
    });
    expect(chat.statusCode).toBe(200);
    const planId = chat.json().actionPlanId;
    expect(planId).toBeTruthy();

    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(confirm.statusCode).toBe(200);
    const result = confirm.json();
    expect(result.errors).toEqual([]);
    expect(result.applied.length).toBe(1);
    expect(result.applied[0].targetType).toBe("act");

    const prisma = await getTestPrisma();
    const act = await prisma.act.findFirst({ where: { userId, invoiceId: inv.id } });
    expect(act).toBeTruthy();
    expect(act?.counterpartyId).toBe(cp.id);
    expect(Number(act?.total)).toBe(10000);

    const audit = await prisma.aiAuditLog.findFirst({ where: { userId, actionType: "create_act_from_invoice" } });
    expect(audit?.targetId).toBe(act?.id);
  });

  it("create_act_from_invoice: дубль — второй акт не создаётся", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    await createInvoice(token, org.id, cp.id);
    await saveMockSettings(token);
    const app = await getTestApp();

    // Первый раз — успешно
    const chat1 = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай акт по счёту", organizationId: org.id, scope: "organization" },
    });
    const planId1 = chat1.json().actionPlanId;
    const c1 = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId1}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(c1.json().applied.length).toBe(1);

    // Второй раз — executor должен отклонить (дубль)
    const chat2 = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай акт по счёту", organizationId: org.id, scope: "organization" },
    });
    const planId2 = chat2.json().actionPlanId;
    const c2 = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId2}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(c2.statusCode).toBe(200);
    expect(c2.json().applied).toEqual([]);
    expect(c2.json().errors.length).toBe(1);
    expect(c2.json().errors[0].error).toMatch(/уже создан акт/i);
  });

  it("create_act_from_invoice: cancelled invoice → error", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = await createInvoice(token, org.id, cp.id);
    // Переводим счёт в CANCELLED через PATCH
    const app = await getTestApp();
    await app.inject({
      method: "PATCH", url: `/api/v1/invoices/${inv.id}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { status: "CANCELLED" },
    });

    await saveMockSettings(token);
    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай акт по счёту", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;
    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(confirm.json().errors.length).toBe(1);
    expect(confirm.json().errors[0].error).toMatch(/отменённого/i);

    const prisma = await getTestPrisma();
    const acts = await prisma.act.findMany({ where: { userId } });
    expect(acts.length).toBe(0);
  });

  /* -------------------- create_contract -------------------- */

  it("create_contract: создаёт договор с auto-number + audit log", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай договор на оказание консультационных услуг", organizationId: org.id, scope: "organization" },
    });
    expect(chat.statusCode).toBe(200);
    const planId = chat.json().actionPlanId;

    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(confirm.json().errors).toEqual([]);
    expect(confirm.json().applied.length).toBe(1);
    expect(confirm.json().applied[0].targetType).toBe("contract");

    const prisma = await getTestPrisma();
    const contract = await prisma.contract.findFirst({ where: { userId } });
    expect(contract).toBeTruthy();
    expect(contract?.subject).toMatch(/консультационных услуг/i);
    expect(contract?.counterpartyId).toBe(cp.id);
    expect(contract?.number).toMatch(/^Д-\d{3}\/\d{4}$/);

    const audit = await prisma.aiAuditLog.findFirst({ where: { userId, actionType: "create_contract" } });
    expect(audit?.targetId).toBe(contract?.id);
  });

  it("create_contract: чужой template → executor отклоняет", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org1 = await createOrganization(u1.token);
    const org2 = await createOrganization(u2.token, { inn: "7728168971", kpp: "772801001" });
    const cp2 = await createCounterparty(u2.token, { inn: "500100732259", kpp: undefined, type: "IP" });

    // u1 создаёт template, у которого organizationId = org1
    const prisma = await getTestPrisma();
    const tpl = await prisma.contractTemplate.create({
      data: { userId: u1.userId, organizationId: org1.id, name: "U1 tpl", content: "Договор {{contract.number}}" },
    });
    // u2 пытается применить план с templateId=tpl.id — executor должен отклонить
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId: u2.userId, organizationId: org2.id, status: "DRAFT", message: "evil",
        planJson: {
          intent: "create_contract", summary: "evil", confidence: 0.9, missingFields: [], warnings: [],
          actions: [{ id: "a1", type: "create_contract", payload: { organizationId: org2.id, counterpartyId: cp2.id, subject: "x", templateId: tpl.id } }],
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
    expect(r.json().errors[0].error).toMatch(/Шаблон/i);
  });

  it("create_contract: без subject — schema отклоняет ещё на /chat", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    await createCounterparty(token);
    await saveMockSettings(token);
    const app = await getTestApp();
    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай договор", organizationId: org.id, scope: "organization" },
    });
    // Mock возвращает plan с missingFields: [subject], actions=[]
    expect(chat.statusCode).toBe(200);
    const body = chat.json();
    expect(body.actionPlan.actions).toEqual([]);
    expect(body.actionPlan.missingFields).toContain("subject");
  });

  /* -------------------- analyze_debt -------------------- */

  it("analyze_debt: возвращает топ должников по организации, не меняет данные", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    // Создаём 2 неоплаченных счёта, один просроченный
    const inv1 = await createInvoice(token, org.id, cp.id, { amount: 5000 });
    const inv2 = await createInvoice(token, org.id, cp.id, { amount: 3000 });
    void inv1; void inv2;
    // Переводим в SENT (по умолчанию DRAFT — для unpaid должно быть SENT/OVERDUE/PARTIALLY_PAID/DRAFT, DRAFT тоже считается)
    await saveMockSettings(token);
    const app = await getTestApp();

    const beforePrisma = await getTestPrisma();
    const invoicesBefore = await beforePrisma.invoice.findMany({});
    const paymentsBefore = await beforePrisma.payment.findMany({});

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Покажи должников", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;
    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(confirm.statusCode).toBe(200);
    const r = confirm.json();
    expect(r.errors).toEqual([]);
    expect(r.applied.length).toBe(1);
    expect(r.applied[0].targetType).toBe("analysis");
    expect(r.applied[0].targetId).toBeNull();

    const analysis = r.applied[0].result;
    expect(analysis.totalDebt).toBe(8000);
    expect(analysis.counterparties.length).toBe(1);
    expect(analysis.counterparties[0].counterpartyId).toBe(cp.id);
    expect(analysis.counterparties[0].debt).toBe(8000);
    expect(analysis.counterparties[0].unpaidInvoicesCount).toBe(2);
    expect(analysis.recommendations.length).toBeGreaterThan(0);

    // Read-only invariant: invoices/payments не изменились
    const invoicesAfter = await beforePrisma.invoice.findMany({});
    const paymentsAfter = await beforePrisma.payment.findMany({});
    expect(invoicesAfter.length).toBe(invoicesBefore.length);
    expect(paymentsAfter.length).toBe(paymentsBefore.length);
  });

  it("analyze_debt: чужой counterparty → executor отклоняет", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org2 = await createOrganization(u2.token);
    const cp1 = await createCounterparty(u1.token);
    const prisma = await getTestPrisma();
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId: u2.userId, organizationId: org2.id, status: "DRAFT", message: "evil",
        planJson: {
          intent: "analyze_debt", summary: "evil", confidence: 0.9, missingFields: [], warnings: [],
          actions: [{ id: "a1", type: "analyze_debt", payload: { organizationId: org2.id, counterpartyId: cp1.id } }],
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

  it("analyze_debt: audit log пишется с targetId=null", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Покажи должников", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;
    await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });

    const prisma = await getTestPrisma();
    const audit = await prisma.aiAuditLog.findFirst({
      where: { userId, actionType: "analyze_debt" },
    });
    expect(audit).toBeTruthy();
    expect(audit?.targetType).toBe("analysis");
    expect(audit?.targetId).toBeNull();
  });
});
