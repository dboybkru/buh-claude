// Sprint 6A: integration AI flow (через Mock provider — без внешней сети).
// Покрывает: settings (apiKey masking, isEnabled), chat → DRAFT plan,
// confirm → executor → audit log, repeat confirm rejected, cross-org denied.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty, getTestPrisma } from "../setup.js";

async function saveMockSettings(token: string) {
  const app = await getTestApp();
  return app.inject({
    method: "PUT",
    url: "/api/v1/ai/settings",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      provider: "mock",
      baseUrl: "mock://local",
      model: "mock-gpt-base",
      temperature: 0.2,
      maxTokens: 2000,
      isEnabled: true,
    },
  });
}

describe("AI flow integration (Mock provider)", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  it("PUT /settings сохраняет mock-провайдера, apiKey не возвращается в открытом виде", async () => {
    const { token } = await registerUser();
    const r = await saveMockSettings(token);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.provider).toBe("mock");
    expect(body.isEnabled).toBe(true);
    expect(body.maskedApiKey).toBe("(mock)");
    expect(body).not.toHaveProperty("apiKey");
  });

  it("GET /settings отдаёт maskedApiKey, не raw", async () => {
    const { token } = await registerUser();
    await saveMockSettings(token);
    const app = await getTestApp();
    const r = await app.inject({
      method: "GET", url: "/api/v1/ai/settings",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).not.toHaveProperty("apiKey");
    expect(body.maskedApiKey).toBeDefined();
  });

  it("POST /test работает с mock-провайдером без сети", async () => {
    const { token } = await registerUser();
    await saveMockSettings(token);
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST", url: "/api/v1/ai/test",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
  });

  it("POST /models возвращает mock-модели", async () => {
    const { token } = await registerUser();
    await saveMockSettings(token);
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST", url: "/api/v1/ai/models",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().models.length).toBeGreaterThan(0);
  });

  it("POST /chat создаёт DRAFT action plan и НЕ пишет бизнес-сущности", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    const r = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай контрагента ООО Ромашка ИНН 7707083893", organizationId: org.id, scope: "organization" },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.actionPlanId).toBeTruthy();
    expect(body.actionPlan.actions.length).toBe(1);
    expect(body.actionPlan.actions[0].type).toBe("create_counterparty");

    // НЕ должно быть контрагентов в БД до confirm
    const prisma = await getTestPrisma();
    const cps = await prisma.counterparty.findMany({ where: { userId } });
    expect(cps.length).toBe(0);

    // Должен быть DRAFT plan
    const plan = await prisma.aiActionPlan.findUnique({ where: { id: body.actionPlanId } });
    expect(plan?.status).toBe("DRAFT");
  });

  it("confirm создаёт counterparty + audit log", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай контрагента ООО Ромашка ИНН 7728168971", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;

    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(confirm.statusCode).toBe(200);
    const result = confirm.json();
    expect(result.applied.length).toBe(1);
    expect(result.applied[0].targetType).toBe("counterparty");
    expect(result.errors).toEqual([]);

    const prisma = await getTestPrisma();
    const cps = await prisma.counterparty.findMany({ where: { userId } });
    expect(cps.length).toBe(1);
    expect(cps[0]?.inn).toBe("7728168971");

    // Audit log записан
    const audit = await prisma.aiAuditLog.findMany({ where: { userId } });
    expect(audit.length).toBe(1);
    expect(audit[0]?.actionType).toBe("create_counterparty");
    expect(audit[0]?.targetId).toBe(cps[0]?.id);

    // Plan переведён в CONFIRMED
    const plan = await prisma.aiActionPlan.findUnique({ where: { id: planId } });
    expect(plan?.status).toBe("CONFIRMED");
    expect(plan?.confirmedAt).toBeTruthy();
  });

  it("repeat confirm возвращает 409 (нельзя применить повторно)", async () => {
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
    const second = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(second.statusCode).toBe(409);
  });

  it("confirm чужого пользователя отклоняется 404", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org = await createOrganization(u1.token);
    await saveMockSettings(u1.token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${u1.token}` },
      payload: { message: "Создай контрагента ООО Тест ИНН 7728168971", organizationId: org.id, scope: "organization" },
    });
    const planId = chat.json().actionPlanId;

    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${u2.token}` }, payload: {},
    });
    expect(r.statusCode).toBe(404);
  });

  it("confirm create_invoice создаёт счёт и audit log", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    await saveMockSettings(token);
    const app = await getTestApp();

    const chat = await app.inject({
      method: "POST", url: "/api/v1/ai/chat",
      headers: { Authorization: `Bearer ${token}` },
      payload: { message: "Создай счёт за консультацию 10000 рублей без НДС", organizationId: org.id, scope: "organization" },
    });
    expect(chat.statusCode).toBe(200);
    const chatBody = chat.json();
    const planId = chatBody.actionPlanId;
    expect(planId).toBeTruthy();
    // Diagnostic: сравним organizationId в action с тестовой org
    const actionPayload = chatBody.actionPlan.actions[0].payload;
    expect(actionPayload.organizationId).toBe(org.id);
    expect(actionPayload.counterpartyId).toBe(cp.id);

    const confirm = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(confirm.statusCode).toBe(200);
    const confirmBody = confirm.json();
    expect(confirmBody.errors).toEqual([]); // если ошибка — упадёт с конкретным сообщением
    expect(confirmBody.applied.length).toBe(1);
    expect(confirmBody.applied[0].targetType).toBe("invoice");

    const prisma = await getTestPrisma();
    const inv = await prisma.invoice.findFirst({ where: { userId, organizationId: org.id } });
    expect(inv).toBeTruthy();
    expect(Number(inv!.total)).toBe(10000);
    expect(inv!.counterpartyId).toBe(cp.id);

    const audit = await prisma.aiAuditLog.findFirst({ where: { userId, actionType: "create_invoice" } });
    expect(audit?.targetId).toBe(inv?.id);
  });

  it("executor отклоняет cross-organization (чужой organizationId)", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org1 = await createOrganization(u1.token);
    await saveMockSettings(u2.token);
    const app = await getTestApp();

    // u2 пишет запрос, но в payload указан чужой organizationId — формируем план вручную через БД
    // (mock-provider использует свой organizationId, поэтому это сценарий «вредоносный JSON»).
    const prisma = await getTestPrisma();
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId: u2.userId,
        organizationId: org1.id,
        status: "DRAFT",
        message: "evil",
        planJson: {
          intent: "create_counterparty",
          summary: "evil",
          confidence: 0.9,
          missingFields: [],
          warnings: [],
          actions: [{ id: "a1", type: "create_counterparty", payload: { organizationId: org1.id, name: "Hack", inn: "7707083893" } }],
        },
      },
    });
    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${plan.id}/confirm`,
      headers: { Authorization: `Bearer ${u2.token}` }, payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.errors.length).toBe(1);
    expect(body.applied).toEqual([]);
  });
});
