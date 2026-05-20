import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization } from "../setup.js";

describe("Organizations integration", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  it("создаёт организацию и возвращает её", async () => {
    const { token } = await registerUser();
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        type: "OOO",
        name: "ООО Альфа",
        fullName: "ООО Альфа полное",
        inn: "7707083893",
        kpp: "770701001",
        legalAddress: "г. Москва",
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().name).toBe("ООО Альфа");
  });

  it("GET / возвращает только организации текущего пользователя", async () => {
    const u1 = await registerUser("u1@example.com");
    const u2 = await registerUser("u2@example.com");
    await createOrganization(u1.token, { name: "User1 Org", inn: "7707083893" });
    await createOrganization(u2.token, { name: "User2 Org", inn: "7728168971", kpp: "772801001" });

    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: "/api/v1/organizations",
      headers: { Authorization: `Bearer ${u1.token}` },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.total).toBe(1);
    expect(body.items[0].name).toBe("User1 Org");
  });

  it("GET /:id чужой организации возвращает 404", async () => {
    const u1 = await registerUser("u1@example.com");
    const u2 = await registerUser("u2@example.com");
    const org = await createOrganization(u1.token);

    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${org.id}`,
      headers: { Authorization: `Bearer ${u2.token}` },
    });
    expect(r.statusCode).toBe(404);
  });

  it("отвергает создание с битым ИНН", async () => {
    const { token } = await registerUser();
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        type: "OOO",
        name: "Bad",
        fullName: "Bad",
        inn: "1234567890",  // битая контрольная сумма
        kpp: "770701001",
        legalAddress: "г. Москва",
      },
    });
    expect(r.statusCode).toBe(400);
  });
});
