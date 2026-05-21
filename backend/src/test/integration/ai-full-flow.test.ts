// Sprint 6.2 regression: full AI workflow end-to-end через Mock provider.
// Один сценарий проходит все 7 action types последовательно, проверяя:
//   - что каждая стадия завершается успешно,
//   - что audit log содержит ровно 7 записей с правильными типами,
//   - что read-only actions не мутируют бизнес-данные,
//   - что mixed confirm: успешные применяются, ошибочные в errors, audit пишется только для успешных.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty, getTestPrisma,
} from "../setup.js";

async function saveMockSettings(token: string) {
  const app = await getTestApp();
  await app.inject({
    method: "PUT", url: "/api/v1/ai/settings",
    headers: { Authorization: `Bearer ${token}` },
    payload: { provider: "mock", baseUrl: "mock://local", model: "mock-gpt-base", temperature: 0.2, maxTokens: 2000, isEnabled: true },
  });
}

async function aiChat(token: string, organizationId: string, message: string) {
  const app = await getTestApp();
  return app.inject({
    method: "POST", url: "/api/v1/ai/chat",
    headers: { Authorization: `Bearer ${token}` },
    payload: { message, organizationId, scope: "organization" },
  });
}

async function aiConfirm(token: string, planId: string, approvedActions?: string[]) {
  const app = await getTestApp();
  return app.inject({
    method: "POST", url: `/api/v1/ai/action-plans/${planId}/confirm`,
    headers: { Authorization: `Bearer ${token}` },
    payload: approvedActions ? { approvedActions } : {},
  });
}

describe("AI full workflow regression (Sprint 6.2)", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  it("end-to-end: counterparty → invoice → act → contract → debt → payment → suggest", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    await saveMockSettings(token);
    const prisma = await getTestPrisma();
    const app = await getTestApp();

    // ─── 1. create_counterparty ───────────────────────────────────────────
    {
      const chat = await aiChat(token, org.id, "Создай контрагента ООО Тестовый ИНН 7728168971");
      expect(chat.statusCode).toBe(200);
      const r = await aiConfirm(token, chat.json().actionPlanId);
      expect(r.json().errors).toEqual([]);
      expect(r.json().applied[0].targetType).toBe("counterparty");
    }
    const cp = await prisma.counterparty.findFirst({ where: { userId } });
    expect(cp).toBeTruthy();

    // ─── 2. create_invoice ────────────────────────────────────────────────
    {
      const chat = await aiChat(token, org.id, "Создай счёт для контрагента на консультацию 10000 без НДС");
      const r = await aiConfirm(token, chat.json().actionPlanId);
      expect(r.json().errors).toEqual([]);
      expect(r.json().applied[0].targetType).toBe("invoice");
    }
    const inv = await prisma.invoice.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    expect(inv).toBeTruthy();
    expect(Number(inv!.total)).toBe(10000);

    // ─── 3. create_act_from_invoice ───────────────────────────────────────
    {
      const chat = await aiChat(token, org.id, "Создай акт по последнему счёту");
      const r = await aiConfirm(token, chat.json().actionPlanId);
      expect(r.json().errors).toEqual([]);
      expect(r.json().applied[0].targetType).toBe("act");
    }
    const act = await prisma.act.findFirst({ where: { userId, invoiceId: inv!.id } });
    expect(act).toBeTruthy();

    // ─── 4. create_contract ───────────────────────────────────────────────
    {
      const chat = await aiChat(token, org.id, "Создай договор на оказание консультационных услуг");
      const r = await aiConfirm(token, chat.json().actionPlanId);
      expect(r.json().errors).toEqual([]);
      expect(r.json().applied[0].targetType).toBe("contract");
    }
    const contract = await prisma.contract.findFirst({ where: { userId } });
    expect(contract).toBeTruthy();

    // ─── 5. analyze_debt (read-only) ──────────────────────────────────────
    let invoiceCountBeforeAnalysis: number;
    {
      invoiceCountBeforeAnalysis = await prisma.invoice.count();
      const chat = await aiChat(token, org.id, "Покажи должников");
      const r = await aiConfirm(token, chat.json().actionPlanId);
      expect(r.json().errors).toEqual([]);
      expect(r.json().applied[0].targetType).toBe("analysis");
      expect(r.json().applied[0].targetId).toBeNull();
      expect(r.json().applied[0].result?.totalDebt).toBeGreaterThan(0);
    }
    // Read-only invariant
    expect(await prisma.invoice.count()).toBe(invoiceCountBeforeAnalysis);

    // ─── 6. create_payment (закрывает счёт) ───────────────────────────────
    {
      const chat = await aiChat(token, org.id, "Создай входящий платёж на 10000 по счёту");
      const r = await aiConfirm(token, chat.json().actionPlanId);
      expect(r.json().errors).toEqual([]);
      expect(r.json().applied[0].targetType).toBe("payment");
    }
    const pay = await prisma.payment.findFirst({ where: { userId } });
    expect(pay).toBeTruthy();
    const invAfterPay = await prisma.invoice.findUnique({ where: { id: inv!.id } });
    expect(invAfterPay?.status).toBe("PAID");

    // ─── 7. suggest_payment_allocations (read-only) ──────────────────────
    const paymentCountBefore = await prisma.payment.count();
    const allocCountBefore = await prisma.paymentAllocation.count();
    {
      const chat = await aiChat(token, org.id, "Распредели платёж 50000 по счетам контрагента");
      const r = await aiConfirm(token, chat.json().actionPlanId);
      expect(r.json().errors).toEqual([]);
      expect(r.json().applied[0].targetType).toBe("analysis");
      expect(r.json().applied[0].targetId).toBeNull();
    }
    // Read-only invariant: payments + allocations не изменились
    expect(await prisma.payment.count()).toBe(paymentCountBefore);
    expect(await prisma.paymentAllocation.count()).toBe(allocCountBefore);

    // ─── Audit log: 7 записей с правильными action types ─────────────────
    const audit = await prisma.aiAuditLog.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    expect(audit.length).toBe(7);
    expect(audit.map((a) => a.actionType)).toEqual([
      "create_counterparty",
      "create_invoice",
      "create_act_from_invoice",
      "create_contract",
      "analyze_debt",
      "create_payment",
      "suggest_payment_allocations",
    ]);
    // Targetы для read-only — null
    const analyzeAudit = audit.find((a) => a.actionType === "analyze_debt");
    const suggestAudit = audit.find((a) => a.actionType === "suggest_payment_allocations");
    expect(analyzeAudit?.targetId).toBeNull();
    expect(suggestAudit?.targetId).toBeNull();

    // ─── GET /audit-log endpoint показывает все 7 ─────────────────────────
    const log = await app.inject({
      method: "GET", url: `/api/v1/ai/audit-log?organizationId=${org.id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(log.statusCode).toBe(200);
    expect(log.json().items.length).toBe(7);
    // payloadJson не утекает
    for (const item of log.json().items) {
      expect(item).not.toHaveProperty("payloadJson");
    }
    void cp; void act; void contract;
  });

  it("mixed confirm: успешные применяются, ошибочные → errors, audit только для успешных", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const prisma = await getTestPrisma();
    const app = await getTestApp();

    // Создаём план вручную с двумя actions: один валидный, один с битым counterpartyId
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId, organizationId: org.id, status: "DRAFT", message: "mixed",
        planJson: {
          intent: "bulk", summary: "Один валидный + один битый", confidence: 0.9, missingFields: [], warnings: [],
          actions: [
            {
              id: "ok-1", type: "create_counterparty",
              payload: { organizationId: org.id, name: "ООО Новый", inn: "500100732259" },
            },
            {
              id: "bad-1", type: "create_invoice",
              payload: {
                organizationId: org.id,
                counterpartyId: "99999999-9999-4999-8999-999999999999",
                date: "2026-05-22",
                items: [{ name: "Услуга", unit: "шт", quantity: 1, price: 1000, vatRate: 22 }],
              },
            },
          ],
        },
      },
    });

    const r = await app.inject({
      method: "POST", url: `/api/v1/ai/action-plans/${plan.id}/confirm`,
      headers: { Authorization: `Bearer ${token}` }, payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.applied.length).toBe(1);
    expect(body.applied[0].id).toBe("ok-1");
    expect(body.applied[0].targetType).toBe("counterparty");
    expect(body.errors.length).toBe(1);
    expect(body.errors[0].id).toBe("bad-1");

    // Только один counterparty создан + только один audit
    const cps = await prisma.counterparty.findMany({ where: { userId } });
    // 2 cp: тот что был от helper + новый
    expect(cps.length).toBe(2);
    const audit = await prisma.aiAuditLog.findMany({ where: { userId } });
    expect(audit.length).toBe(1);
    expect(audit[0]?.actionType).toBe("create_counterparty");
    expect(audit[0]?.targetId).toBeTruthy();

    // Plan переведён в CONFIRMED (так как applied > 0)
    const planAfter = await prisma.aiActionPlan.findUnique({ where: { id: plan.id } });
    expect(planAfter?.status).toBe("CONFIRMED");
    void cp;
  });

  it("partial confirm + audit visibility через endpoint: только выбранные пишутся", async () => {
    const { token, userId } = await registerUser();
    const org = await createOrganization(token);
    const prisma = await getTestPrisma();
    const app = await getTestApp();

    // План с двумя counterparty actions
    const plan = await prisma.aiActionPlan.create({
      data: {
        userId, organizationId: org.id, status: "DRAFT", message: "two",
        planJson: {
          intent: "bulk", summary: "Два", confidence: 0.9, missingFields: [], warnings: [],
          actions: [
            { id: "a1", type: "create_counterparty", payload: { organizationId: org.id, name: "Один", inn: "7728168971" } },
            { id: "a2", type: "create_counterparty", payload: { organizationId: org.id, name: "Два",  inn: "500100732259" } },
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
    expect(r.json().applied.length).toBe(1);
    expect(r.json().skipped.length).toBe(1);

    // Audit endpoint: ровно 1 запись с targetId 1-й cp
    const log = await app.inject({
      method: "GET", url: `/api/v1/ai/audit-log`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(log.json().items.length).toBe(1);
    expect(log.json().items[0].actionType).toBe("create_counterparty");
    expect(log.json().items[0].targetId).toBeTruthy();
    void userId;
  });
});
