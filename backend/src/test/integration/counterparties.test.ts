import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty } from "../setup.js";

describe("Counterparties integration", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  it("создаёт контрагента", async () => {
    const { token } = await registerUser();
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
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().name).toBe("ООО Бета");
  });

  it("проверяет обязательные поля (name, inn)", async () => {
    const { token } = await registerUser();
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/counterparties",
      headers: { Authorization: `Bearer ${token}` },
      payload: { type: "OOO" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("отвергает создание контрагента с тем же ИНН/КПП, что у собственной организации", async () => {
    const { token } = await registerUser();
    await createOrganization(token, { inn: "7707083893", kpp: "770701001" });

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/counterparties",
      headers: { Authorization: `Bearer ${token}` },
      payload: { type: "OOO", inn: "7707083893", kpp: "770701001", name: "Сам себе" },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json();
    // Единый формат ошибок { error: { code, message } }
    const code = body.error?.code ?? body.error;
    const message = body.error?.message ?? body.message;
    expect(code).toBe("Conflict");
    expect(message).toContain("собственную организацию");
  });

  it("разрешает создание контрагента с тем же ИНН но другим КПП (другое юр.лицо группы)", async () => {
    const { token } = await registerUser();
    await createOrganization(token, { inn: "7707083893", kpp: "770701001" });
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/counterparties",
      headers: { Authorization: `Bearer ${token}` },
      payload: { type: "OOO", inn: "7707083893", kpp: "770801001", name: "Филиал" },
    });
    expect(r.statusCode).toBe(201);
  });

  it("не показывает контрагентов чужого пользователя", async () => {
    const u1 = await registerUser("u1@example.com");
    const u2 = await registerUser("u2@example.com");
    await createCounterparty(u1.token);
    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/counterparties",
      headers: { Authorization: `Bearer ${u2.token}` },
    });
    expect(r.json().total).toBe(0);
  });
});
