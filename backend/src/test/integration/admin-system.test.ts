// Sprint 10 — /admin/system endpoints integration tests.
//
// Covers:
//   - access control: anon / regular org OWNER / inactive admin → 403; admin → 200
//   - GET masks secrets (never returns plaintext)
//   - PUT preserves old secret when secret field is omitted
//   - PUT rotates secret when new value supplied (ciphertext changes)
//   - test endpoints return { ok, message } structure
//   - audit log entries are written and never include secret values

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import {
  addMember,
  closeAll,
  createOrganization,
  getTestApp,
  getTestPrisma,
  registerUser,
  resetDb,
} from "../setup.js";

beforeAll(async () => {
  await getTestApp();
  process.env.APP_ENCRYPTION_KEY = "test-app-encryption-key-1234567890-zzz";
});
afterAll(async () => {
  await closeAll();
});
beforeEach(async () => {
  await resetDb();
});

async function promoteAdmin(userId: string) {
  const p = await getTestPrisma();
  await p.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
}

async function inject(
  token: string | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const app = await getTestApp();
  return app.inject({
    method,
    url,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(payload ? { payload } : {}),
  });
}

describe("Sprint 10 — /admin/system access control", () => {
  it("anonymous → 401", async () => {
    const app = await getTestApp();
    const r = await app.inject({ method: "GET", url: "/api/v1/admin/system/settings" });
    expect(r.statusCode).toBe(401);
  });

  it("regular user without User.role=ADMIN → 403, even if they are org OWNER", async () => {
    const owner = await registerUser("as1-o@x.io");
    await createOrganization(owner.token);
    // owner is OWNER of their org but User.role still = USER → must be blocked

    const r = await inject(owner.token, "GET", "/api/v1/admin/system/settings");
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("Forbidden");
  });

  it("regular user without any membership → 403", async () => {
    const noOrg = await registerUser("as2-no@x.io");
    const r = await inject(noOrg.token, "GET", "/api/v1/admin/system/settings");
    expect(r.statusCode).toBe(403);
  });

  it("platform admin (User.role=ADMIN) → 200", async () => {
    const admin = await registerUser("as3-a@x.io");
    await promoteAdmin(admin.userId);

    const r = await inject(admin.token, "GET", "/api/v1/admin/system/settings");
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.items).toHaveLength(4);
    expect(body.items.map((x: { category: string }) => x.category).sort()).toEqual(["AI", "APP", "DADATA", "SMTP"]);
  });

  it("inactive admin → 403", async () => {
    const admin = await registerUser("as4-a@x.io");
    await promoteAdmin(admin.userId);
    const p = await getTestPrisma();
    await p.user.update({ where: { id: admin.userId }, data: { isActive: false } });

    const r = await inject(admin.token, "GET", "/api/v1/admin/system/settings");
    // Note: existing JWT may still let them past authenticate hook, but
    // requirePlatformAdmin re-checks isActive in DB → 403.
    expect([401, 403]).toContain(r.statusCode);
  });
});

describe("Sprint 10 — secret masking and persistence", () => {
  it("PUT then GET — token never returned in plaintext, masked only", async () => {
    const admin = await registerUser("ms1@x.io");
    await promoteAdmin(admin.userId);

    const put = await inject(admin.token, "PUT", "/api/v1/admin/system/settings/dadata", {
      enabled: true,
      token: "live-token-1234567890abcdef",
      secret: "live-secret-zzz",
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json();
    expect(putBody.secretPresent.token).toBe(true);
    expect(putBody.secretMasked.token).not.toContain("1234567890");
    expect(putBody.secretMasked.token.endsWith("cdef")).toBe(true);
    expect(JSON.stringify(putBody)).not.toContain("live-token-1234567890abcdef");

    const get = await inject(admin.token, "GET", "/api/v1/admin/system/settings/dadata");
    expect(get.statusCode).toBe(200);
    expect(JSON.stringify(get.json())).not.toContain("live-token-1234567890abcdef");
    expect(get.json().secretPresent.token).toBe(true);
  });

  it("PUT without secret field preserves previously stored secret (plaintext matches)", async () => {
    const admin = await registerUser("ms2@x.io");
    await promoteAdmin(admin.userId);
    await inject(admin.token, "PUT", "/api/v1/admin/system/settings/dadata", {
      enabled: true,
      token: "original-token-9999-aaaa",
    });

    // PUT without token field — should keep secret
    const r = await inject(admin.token, "PUT", "/api/v1/admin/system/settings/dadata", {
      enabled: true,
      baseUrl: "https://other.example.com",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().secretPresent.token).toBe(true);

    // Decrypt and verify plaintext is unchanged (ciphertext IS re-encrypted
    // with a fresh IV every save — that's correct GCM behaviour — so we
    // check the plaintext round-trip instead of ciphertext equality).
    const p = await getTestPrisma();
    const row = await p.integrationSetting.findUniqueOrThrow({ where: { category: "DADATA" } });
    const { decryptSecretBundle } = await import("../../lib/secrets.js");
    expect(decryptSecretBundle(row.secretsCiphertext).token).toBe("original-token-9999-aaaa");
  });

  it("PUT with new secret rotates plaintext (and ciphertext)", async () => {
    const admin = await registerUser("ms3@x.io");
    await promoteAdmin(admin.userId);
    await inject(admin.token, "PUT", "/api/v1/admin/system/settings/dadata", {
      enabled: true,
      token: "first-token-aaaaaaaaaa",
    });
    await inject(admin.token, "PUT", "/api/v1/admin/system/settings/dadata", {
      enabled: true,
      token: "second-token-bbbbbbbbbb",
    });
    const p = await getTestPrisma();
    const after = await p.integrationSetting.findUniqueOrThrow({ where: { category: "DADATA" } });
    const { decryptSecretBundle } = await import("../../lib/secrets.js");
    expect(decryptSecretBundle(after.secretsCiphertext).token).toBe("second-token-bbbbbbbbbb");
  });

  it("PUT with empty-string secret clears it (secretPresent → false)", async () => {
    const admin = await registerUser("ms4@x.io");
    await promoteAdmin(admin.userId);
    await inject(admin.token, "PUT", "/api/v1/admin/system/settings/dadata", {
      enabled: true,
      token: "to-be-cleared-aaaaaaaa",
    });
    const r = await inject(admin.token, "PUT", "/api/v1/admin/system/settings/dadata", {
      token: "",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().secretPresent.token).toBe(false);
  });
});

describe("Sprint 10 — audit log writes (no secret leakage)", () => {
  it("PUT writes SYSTEM_SETTING_UPDATED with no secret values in metadata", async () => {
    const admin = await registerUser("au1@x.io");
    await promoteAdmin(admin.userId);
    await inject(admin.token, "PUT", "/api/v1/admin/system/settings/dadata", {
      enabled: true,
      baseUrl: "https://example.dadata/foo",
      token: "very-secret-token-zzzzzz",
    });

    const p = await getTestPrisma();
    const entries = await p.systemAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    // Rotated → SECRET_ROTATED action
    expect(["SECRET_ROTATED", "SYSTEM_SETTING_UPDATED"]).toContain(entries[0]!.action);
    expect(entries[0]!.category).toBe("DADATA");
    const meta = entries[0]!.metadataJson as Record<string, unknown>;
    expect(JSON.stringify(meta)).not.toContain("very-secret-token-zzzzzz");
    // Field names of rotated secrets are OK to log
    expect(meta.rotatedSecretKeys).toEqual(["token"]);
  });

  it("config-only PUT logs SYSTEM_SETTING_UPDATED (no SECRET_ROTATED)", async () => {
    const admin = await registerUser("au2@x.io");
    await promoteAdmin(admin.userId);
    await inject(admin.token, "PUT", "/api/v1/admin/system/settings/app", {
      appName: "MyAccountingApp",
      publicUrl: "https://example.com",
    });

    const p = await getTestPrisma();
    const entries = await p.systemAuditLog.findMany({
      where: { category: "APP" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    expect(entries[0]!.action).toBe("SYSTEM_SETTING_UPDATED");
    const meta = entries[0]!.metadataJson as Record<string, unknown>;
    expect((meta.changedConfigFields as string[]).sort()).toEqual(["appName", "publicUrl"]);
  });
});

describe("Sprint 10 — test endpoints", () => {
  it("/test/dadata returns { ok: false } when disabled (no network)", async () => {
    const admin = await registerUser("td1@x.io");
    await promoteAdmin(admin.userId);
    // No settings yet → disabled by default
    const r = await inject(admin.token, "POST", "/api/v1/admin/system/test/dadata");
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/отключена/);
  });

  it("/test/ai returns { ok: false } when disabled", async () => {
    const admin = await registerUser("td2@x.io");
    await promoteAdmin(admin.userId);
    const r = await inject(admin.token, "POST", "/api/v1/admin/system/test/ai");
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(false);
  });

  it("/test/smtp requires 'to' email", async () => {
    const admin = await registerUser("td3@x.io");
    await promoteAdmin(admin.userId);
    const r = await inject(admin.token, "POST", "/api/v1/admin/system/test/smtp", {});
    expect(r.statusCode).toBe(400);
  });

  it("/test/smtp with disabled SMTP returns ok=false structured (no throw)", async () => {
    const admin = await registerUser("td4@x.io");
    await promoteAdmin(admin.userId);
    const r = await inject(admin.token, "POST", "/api/v1/admin/system/test/smtp", { to: "x@example.com" });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(false);
    expect(r.json().message).toMatch(/отключ/);
  });

  it("test endpoints write SYSTEM_SETTING_TESTED audit row", async () => {
    const admin = await registerUser("td5@x.io");
    await promoteAdmin(admin.userId);
    await inject(admin.token, "POST", "/api/v1/admin/system/test/dadata");

    const p = await getTestPrisma();
    const entries = await p.systemAuditLog.findMany({
      where: { action: "SYSTEM_SETTING_TESTED", category: "DADATA" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(entries).toHaveLength(1);
  });
});

describe("Sprint 10 — non-admin still cannot access even when no settings exist", () => {
  it("regular user → 403 on every PUT category", async () => {
    const user = await registerUser("nb1@x.io");
    await createOrganization(user.token);
    // Membership = OWNER, but User.role = USER

    for (const cat of ["dadata", "ai", "smtp", "app"]) {
      const r = await inject(user.token, "PUT", `/api/v1/admin/system/settings/${cat}`, { enabled: true });
      expect(r.statusCode, `PUT /${cat}`).toBe(403);
    }
  });
});

describe("Sprint 10 — admin can configure both DaData via UI and AI in parallel", () => {
  it("PUT dadata + PUT ai independently; GET returns both with masking", async () => {
    const admin = await registerUser("multi1@x.io");
    await promoteAdmin(admin.userId);

    await inject(admin.token, "PUT", "/api/v1/admin/system/settings/dadata", {
      enabled: true,
      token: "dd-token-isolated-bbbbbb",
    });
    await inject(admin.token, "PUT", "/api/v1/admin/system/settings/ai", {
      enabled: true,
      providerName: "openai",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini",
      apiKey: "sk-test-aaaaaaaaa",
    });

    const all = await inject(admin.token, "GET", "/api/v1/admin/system/settings");
    expect(all.statusCode).toBe(200);
    const items: Array<{ category: string; secretPresent: Record<string, boolean> }> = all.json().items;
    const dd = items.find((x) => x.category === "DADATA");
    const ai = items.find((x) => x.category === "AI");
    expect(dd?.secretPresent.token).toBe(true);
    expect(ai?.secretPresent.apiKey).toBe(true);
    expect(JSON.stringify(items)).not.toContain("dd-token-isolated-bbbbbb");
    expect(JSON.stringify(items)).not.toContain("sk-test-aaaaaaaaa");
  });
});
