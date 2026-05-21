import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import FormData from "form-data";
import fs from "node:fs";
import path from "node:path";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization } from "../setup.js";

// Минимальный PNG (1×1 прозрачный) — для проверки upload без сторонних библиотек
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function tinyPngBuffer(): Buffer {
  return Buffer.from(TINY_PNG_BASE64, "base64");
}

async function uploadFile(token: string, orgId: string, kind: "logo" | "stamp" | "signature", fileBuf: Buffer, filename = "image.png", mime = "image/png") {
  const app = await getTestApp();
  const form = new FormData();
  form.append("file", fileBuf, { filename, contentType: mime });
  return app.inject({
    method: "POST",
    url: `/api/v1/files/organizations/${orgId}/${kind}`,
    payload: form.getBuffer(),
    headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
  });
}

describe("Files (uploads) integration", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => {
    await resetDb();
    // Clean uploads dir from previous run (best-effort)
    try {
      const root = path.resolve(process.cwd(), "uploads");
      const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.isDirectory()) await fs.promises.rm(path.join(root, e.name), { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  });

  it("позволяет владельцу организации загрузить логотип и скачать его", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const r = await uploadFile(token, org.id, "logo", tinyPngBuffer());
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.kind).toBe("logo");
    expect(body.path).toMatch(/logo-.+\.png$/);

    // Скачать
    const app = await getTestApp();
    const download = await app.inject({
      method: "GET",
      url: `/api/v1/files/${body.path}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("image/png");
  });

  it("отклоняет загрузку неподдерживаемого MIME-типа", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const r = await uploadFile(token, org.id, "logo", Buffer.from("plain text"), "evil.txt", "text/plain");
    expect(r.statusCode).toBe(400);
  });

  it("чужой пользователь не может скачать файл", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org = await createOrganization(u1.token);
    const up = await uploadFile(u1.token, org.id, "logo", tinyPngBuffer());
    expect(up.statusCode).toBe(201);
    const filePath = up.json().path;

    const app = await getTestApp();
    const r = await app.inject({
      method: "GET",
      url: `/api/v1/files/${filePath}`,
      headers: { Authorization: `Bearer ${u2.token}` },
    });
    expect([403, 404]).toContain(r.statusCode);
  });

  it("чужой пользователь не может загрузить файл к чужой организации", async () => {
    const u1 = await registerUser("a@example.com");
    const u2 = await registerUser("b@example.com");
    const org = await createOrganization(u1.token);
    const r = await uploadFile(u2.token, org.id, "stamp", tinyPngBuffer());
    expect(r.statusCode).toBe(404);
  });

  it("DELETE обнуляет поле организации", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    await uploadFile(token, org.id, "signature", tinyPngBuffer());

    const app = await getTestApp();
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/files/organizations/${org.id}/signature`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
    const after = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${org.id}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.json().signature).toBeNull();
  });
});
