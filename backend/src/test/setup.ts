// Общий setup для integration-тестов: каждый тест работает с TEST_DATABASE_URL
// (отдельная БД buhclaude_test). Перед каждым тестом таблицы чистятся через TRUNCATE,
// чтобы тесты были полностью изолированы и воспроизводимы.

import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

// Переключаем env на test-БД до того, как будет загружен env.ts / prisma.ts
process.env.NODE_ENV = "test";
if (!process.env.TEST_DATABASE_URL) {
  process.env.TEST_DATABASE_URL = "postgresql://buhclaude:buhclaude_secret@localhost:5432/buhclaude_test?schema=public";
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-1234567890-1234567890-12345";
process.env.LOG_LEVEL = "silent";

// Создаём отдельный prisma-клиент для test-БД (после установки env)
let testPrisma: PrismaClient | null = null;
let testApp: FastifyInstance | null = null;

export async function getTestPrisma(): Promise<PrismaClient> {
  if (!testPrisma) {
    testPrisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  }
  return testPrisma;
}

export async function getTestApp(): Promise<FastifyInstance> {
  if (!testApp) {
    const { buildServer } = await import("../server.js");
    testApp = await buildServer();
    await testApp.ready();
  }
  return testApp;
}

export async function resetDb(): Promise<void> {
  const p = await getTestPrisma();
  // TRUNCATE в правильном порядке (FK). RESTART IDENTITY чтобы счётчики обнулились.
  await p.$executeRawUnsafe(`
    TRUNCATE TABLE
      "PaymentAllocation", "Payment", "DocumentItem",
      "Invoice", "Act", "UpdDocument", "Waybill",
      "ReconciliationAct", "Contract", "ContractTemplate", "BankAccount",
      "Nomenclature", "Counterparty", "DocumentNumbering",
      "AiAuditLog", "AiActionPlan", "AiSettings",
      "OrganizationMember",
      "Organization", "UserSession", "User"
    RESTART IDENTITY CASCADE;
  `);
}

export async function closeAll(): Promise<void> {
  if (testApp) await testApp.close();
  if (testPrisma) await testPrisma.$disconnect();
  testApp = null;
  testPrisma = null;
}

/** Регистрирует пользователя и возвращает токен. */
export async function registerUser(email = "test@example.com", password = "password123"): Promise<{ token: string; userId: string }> {
  const app = await getTestApp();
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password, fullName: "Test User" },
  });
  if (r.statusCode !== 201) throw new Error(`register failed: ${r.statusCode} ${r.body}`);
  const body = r.json();
  return { token: body.token, userId: body.user.id };
}

/** Создаёт организацию и возвращает её id. */
export async function createOrganization(token: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const app = await getTestApp();
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/organizations",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      type: "OOO",
      name: "ООО Тест",
      fullName: "Общество с ограниченной ответственностью \"Тест\"",
      inn: "7707083893",
      kpp: "770701001",
      legalAddress: "г. Москва, ул. Тестовая, д. 1",
      ...overrides,
    },
  });
  if (r.statusCode !== 201) throw new Error(`createOrganization failed: ${r.statusCode} ${r.body}`);
  return { id: r.json().id };
}

/** Sprint 9: add a member to an organization with a specific role. */
export async function addMember(params: {
  organizationId: string;
  userId: string;
  role: "OWNER" | "ADMIN" | "ACCOUNTANT" | "VIEWER";
  status?: "ACTIVE" | "INVITED" | "DISABLED";
}): Promise<{ id: string }> {
  const p = await getTestPrisma();
  const created = await p.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: params.organizationId, userId: params.userId } },
    update: { role: params.role, status: params.status ?? "ACTIVE" },
    create: {
      organizationId: params.organizationId,
      userId: params.userId,
      role: params.role,
      status: params.status ?? "ACTIVE",
    },
    select: { id: true },
  });
  return created;
}

/** Создаёт контрагента, возвращает id. */
export async function createCounterparty(token: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const app = await getTestApp();
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/counterparties",
    headers: { Authorization: `Bearer ${token}` },
    payload: {
      type: "OOO",
      inn: "7728168971",
      kpp: "772801001",
      name: "ООО Бета",
      ...overrides,
    },
  });
  if (r.statusCode !== 201) throw new Error(`createCounterparty failed: ${r.statusCode} ${r.body}`);
  return { id: r.json().id };
}
