// Sprint 7 integration: /health (публичный) и /ready (DB + uploads).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll } from "../setup.js";

describe("Health & readiness endpoints (Sprint 7)", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  it("GET /health работает без авторизации и возвращает базовые поля", async () => {
    const app = await getTestApp();
    const r = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("buhclaude-api");
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(typeof body.nodeEnv).toBe("string");
    expect(body.timestamp).toBeTruthy();
  });

  it("GET /health НЕ требует Authorization (публичный)", async () => {
    const app = await getTestApp();
    const r = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(r.statusCode).toBe(200);
    // Без заголовка — должно работать
  });

  it("GET /ready возвращает 200 при доступной БД + uploads", async () => {
    const app = await getTestApp();
    const r = await app.inject({ method: "GET", url: "/api/v1/ready" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
    expect(body.checks.uploads).toBe("ok");
  });

  it("GET /ready не раскрывает технические детали БД (нет hostname / connection string)", async () => {
    const app = await getTestApp();
    const r = await app.inject({ method: "GET", url: "/api/v1/ready" });
    const text = r.body;
    // В ответе НЕ должно быть фрагментов connection string
    expect(text).not.toMatch(/postgres:\/\//);
    expect(text).not.toMatch(/password/i);
    expect(text).not.toMatch(/secret/i);
  });
});
