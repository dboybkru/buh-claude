import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser } from "../setup.js";

describe("Auth integration", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  it("регистрирует пользователя и возвращает токен", async () => {
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "user1@example.com", password: "password123", fullName: "User 1" },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.user.email).toBe("user1@example.com");
    expect(body.token).toBeTruthy();
  });

  it("логинит существующего пользователя", async () => {
    await registerUser("login@example.com", "password123");
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "login@example.com", password: "password123" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().token).toBeTruthy();
  });

  it("отвергает логин с неправильным паролем", async () => {
    await registerUser("wrong@example.com");
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "wrong@example.com", password: "bad" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("GET /me с валидным токеном возвращает пользователя", async () => {
    const { token } = await registerUser("me@example.com");
    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().user.email).toBe("me@example.com");
  });

  it("GET /me без токена возвращает 401", async () => {
    const app = await getTestApp();
    const r = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(r.statusCode).toBe(401);
  });
});
