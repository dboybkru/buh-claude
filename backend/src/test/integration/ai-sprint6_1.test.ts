// Sprint 6.1 integration: audit-log endpoint, safety hardening,
// partial confirm, unknown approvedActions, expired plan, read-only invariant.

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

describe("AI Sprint 6.1 integration", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  /* -------------------- /audit-log endpoint -------------------- */

  it("GET /audit-log возвращает только записи текущего пользователя", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org1 = await createOrganization(u1.token);
    await saveMockSettings(u1.token);
    await saveMockSettings(u2.token);
    const app = await getTestApp();

    // u1 создаёт contract through AI
    const chat1 = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${u1.token}` },
      payload: { message: "Создай контрагента ООО Тест ИНН 7728168971", organizationId: org1.id, scope: "organization" },
    });
    const planId1 = chat1.json().actionPlanId;
    await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId1}/confirm`,
      headers: { Authorization: `Bearer ${u1.token}` }, payload: {},
    });

    // u1 видит свой audit log
    const log1 = await app.inject({
      method: "GET", url: "/api/v1/ai/audit-log",
      headers: { Authorization: `Bearer ${u1.token}` },
    });
    expect(log1.statusCode).toBe(200);
    expect(log1.json().items.length).toBe(1);
    expect(log1.json().items[0].actionType).toBe("create_counterparty");

    // u2 не видит audit log u1
    const log2 = await app.inject({
      method: "GET", url: "/api/v1/ai/audit-log",
      headers: { Authorization: `Bearer ${u2.token}` },
    });
    expect(log2.json().items).toEqual([]);
  });

  it("GET /audit-log не отдаёт payloadJson наружу", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай контрагента ООО Тест ИНН 7728168971", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;
    await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });

    const log = await app.inject({
      method: "GET", url: "/api/v1/ai/audit-log",
      headers: { Authorization: `Bearer ${token}` },
    });
    const item = log.json().items[0];
    expect(item).not.toHaveProperty("payloadJson");
    expect(item.actionPlan?.message).toBeTruthy();
  });

  it("GET /audit-log для analyze_debt возвращает targetId=null", async () => {
    const { token } = await registerUser();
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

    const log = await app.inject({
      method: "GET", url: "/api/v1/ai/audit-log",
      headers: { Authorization: `Bearer ${token}` },
    });
    const item = log.json().items[0];
    expect(item.actionType).toBe("analyze_debt");
    expect(item.targetType).toBe("analysis");
    expect(item.targetId).toBeNull();
  });

  /* -------------------- safety: approvedActions -------------------- */

  it("confirm с неизвестным approvedActions id → 400", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай контрагента ООО Тест ИНН 7728168971", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;

    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { approvedActions: ["non-existent-id"] },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json();
    const message = body.error?.message ?? body.message ?? "";
    expect(message).toMatch(/Неизвестные approvedActions/i);
  });

  it("partial confirm — выбранный action применяется, остальные skipped", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    // Создаём план с двумя actions вручную через БД (mock не генерит multi-action)
    const prisma = await getTestPrisma();
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId, organizationId: org.id, status: "DRAFT", message: "two actions",
        planJson: {
          intent: "bulk", summary: "Два контрагента", confidence: 0.9, missingFields: [], warnings: [],
          actions: [
            { id: "a1", type: "create_counterparty", payload: { organizationId: org.id, name: "ООО Один", inn: "7728168971" } },
            { id: "a2", type: "create_counterparty", payload: { organizationId: org.id, name: "ООО Два", inn: "500100732259" } },
          ],
        },
      },
    });

    // Подтверждаем только a1
    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${plan.id}/confirm`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { approvedActions: ["a1"] },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.applied.length).toBe(1);
    expect(body.applied[0].id).toBe("a1");
    expect(body.skipped.length).toBe(1);
    expect(body.skipped[0].id).toBe("a2");
    expect(body.errors).toEqual([]);

    // В БД только один counterparty
    const cps = await prisma.counterparty.findMany({ where: { userId } });
    expect(cps.length).toBe(1);
    expect(cps[0]?.name).toBe("ООО Один");

    // Audit log — тоже только один
    const audit = await prisma.aiAuditLog.findMany({ where: { userId } });
    expect(audit.length).toBe(1);
  });

  /* -------------------- safety: expired plan -------------------- */

  it("EXPIRED plan возвращает 409 при попытке confirm", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const app = await getTestApp();

    const prisma = await getTestPrisma();
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId, organizationId: org.id, status: "DRAFT", message: "old",
        planJson: {
          intent: "x", summary: "x", confidence: 0.5, missingFields: [], warnings: [], actions: [],
        },
        expiresAt: new Date(Date.now() - 60 * 1000), // истёк минуту назад
      },
    });

    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${plan.id}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(r.statusCode).toBe(409);
    const message = r.json().error?.message ?? r.json().message ?? "";
    expect(message).toMatch(/Срок действия/i);

    // Plan переведён в EXPIRED
    const after = await prisma.aiActionPlan.findUnique({ where: { id: plan.id } });
    expect(after?.status).toBe("EXPIRED");
  });

  /* -------------------- safety: failed action не пишет audit -------------------- */

  it("failed action НЕ создаёт запись в AiAuditLog", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    // Создаём plan с заведомо невалидным действием (несуществующий counterpartyId для invoice)
    const prisma = await getTestPrisma();
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId, organizationId: org.id, status: "DRAFT", message: "evil",
        planJson: {
          intent: "create_invoice", summary: "evil", confidence: 0.9, missingFields: [], warnings: [],
          actions: [{
            id: "a1", type: "create_invoice",
            payload: {
              organizationId: org.id,
              counterpartyId: "99999999-9999-4999-8999-999999999999", // не существует
              date: "2026-05-21",
              items: [{ name: "Х", unit: "шт", quantity: 1, price: 1000, vatRate: 22 }],
            },
          }],
        },
      },
    });

    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${plan.id}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().applied).toEqual([]);
    expect(r.json().errors.length).toBe(1);

    // Audit log пуст
    const audit = await prisma.aiAuditLog.findMany({ where: { userId } });
    expect(audit.length).toBe(0);
  });

  /* -------------------- read-only invariant для analyze_debt -------------------- */

  it("analyze_debt: invoices/payments/allocations не мутируют", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const app = await getTestApp();
    // Создаём счёт и платёж — фон состояния
    await app.inject({
      method: "POST", url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id, counterpartyId: cp.id, date: "2026-05-01",
        vatRate: 22, vatIncluded: true,
        items: [{ name: "Услуга", unit: "шт", unitCode: "796", quantity: 1, price: 5000, vatRate: 22 }],
      },
    });
    await saveMockSettings(token);

    const prisma = await getTestPrisma();
    const invBefore = await prisma.invoice.findMany();
    const payBefore = await prisma.payment.findMany();
    const allocBefore = await prisma.paymentAllocation.findMany();

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
    expect(confirm.json().errors).toEqual([]);

    const invAfter = await prisma.invoice.findMany();
    const payAfter = await prisma.payment.findMany();
    const allocAfter = await prisma.paymentAllocation.findMany();
    expect(invAfter.length).toBe(invBefore.length);
    expect(payAfter.length).toBe(payBefore.length);
    expect(allocAfter.length).toBe(allocBefore.length);
    // Тотал/статус не изменились
    expect(invAfter[0]?.status).toBe(invBefore[0]?.status);
    expect(invAfter[0]?.total.toString()).toBe(invBefore[0]?.total.toString());
  });
});
