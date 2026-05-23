// Sprint 9C: platform-admin (User.role=ADMIN) bypass tests.
//
// A user with the GLOBAL User.role=ADMIN gets implicit OWNER access to every
// organization. Covers cross-org visibility, write, AI settings, members
// management, plus the negative case (regular USER still locked out) and
// the invariant that last-owner guard is not bypassed.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { LightMyRequestResponse } from "fastify";
import {
  addMember,
  closeAll,
  createCounterparty,
  createOrganization,
  getTestApp,
  getTestPrisma,
  registerUser,
  resetDb,
} from "../setup.js";

beforeAll(async () => {
  await getTestApp();
});
afterAll(async () => {
  await closeAll();
});
beforeEach(async () => {
  await resetDb();
});

async function promoteToPlatformAdmin(userId: string) {
  const p = await getTestPrisma();
  await p.user.update({ where: { id: userId }, data: { role: "ADMIN" } });
}

async function inject(
  token: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  const app = await getTestApp();
  return app.inject({
    method,
    url,
    headers: { Authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });
}

describe("Sprint 9C — platform admin (User.role=ADMIN)", () => {
  it("admin sees every organization in GET /organizations, even ones they're not a member of", async () => {
    const admin = await registerUser("sa1-admin@x.io");
    const ownerA = await registerUser("sa1-a@x.io");
    const ownerB = await registerUser("sa1-b@x.io");
    const orgA = await createOrganization(ownerA.token, { inn: "7707083893", kpp: "770701001", name: "ООО А" });
    const orgB = await createOrganization(ownerB.token, { inn: "5260200603", kpp: "526001001", name: "ООО Б" });
    await promoteToPlatformAdmin(admin.userId);

    const r = await inject(admin.token, "GET", "/api/v1/organizations");
    expect(r.statusCode).toBe(200);
    const ids: string[] = r.json().items.map((o: { id: string }) => o.id);
    expect(ids).toEqual(expect.arrayContaining([orgA.id, orgB.id]));
  });

  it("regular USER (without ADMIN role) still only sees their own orgs", async () => {
    const user = await registerUser("sa2-u@x.io");
    const owner = await registerUser("sa2-o@x.io");
    await createOrganization(owner.token);
    // user has no membership anywhere

    const r = await inject(user.token, "GET", "/api/v1/organizations");
    expect(r.statusCode).toBe(200);
    expect(r.json().items).toHaveLength(0);
  });

  it("admin reads a foreign org's invoice and AI settings", async () => {
    const admin = await registerUser("sa3-admin@x.io");
    const owner = await registerUser("sa3-o@x.io");
    const org = await createOrganization(owner.token);
    const cp = await createCounterparty(owner.token);
    // owner creates an invoice in their org
    const inv = await inject(owner.token, "POST", "/api/v1/invoices", {
      organizationId: org.id,
      counterpartyId: cp.id,
      date: "2026-05-23",
      vatRate: 22,
      items: [{ name: "Услуга", quantity: 1, price: 1000, vatRate: 22 }],
    });
    expect(inv.statusCode).toBe(201);
    const invId = inv.json().id;

    await promoteToPlatformAdmin(admin.userId);

    // admin reads invoice belonging to a foreign org
    const r = await inject(admin.token, "GET", `/api/v1/invoices/${invId}`);
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(invId);

    // admin reads AI settings (ai:settings is ADMIN+ in OrganizationMember
    // matrix). This requires platform admin bypass via getMembership.
    const aiGet = await inject(admin.token, "GET", "/api/v1/ai/settings");
    expect(aiGet.statusCode).toBe(200);
  });

  it("admin invites a member into a foreign organization", async () => {
    const admin = await registerUser("sa4-admin@x.io");
    const owner = await registerUser("sa4-o@x.io");
    const org = await createOrganization(owner.token);
    await promoteToPlatformAdmin(admin.userId);

    const r = await inject(admin.token, "POST", `/api/v1/organizations/${org.id}/members/invite`, {
      email: "newbie@x.io",
      role: "ACCOUNTANT",
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("INVITED");

    // members listing also works for admin
    const list = await inject(admin.token, "GET", `/api/v1/organizations/${org.id}/members`);
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThanOrEqual(2); // owner + invited
  });

  it("admin can create an invoice in a foreign org (data:write bypass)", async () => {
    const admin = await registerUser("sa5-admin@x.io");
    const owner = await registerUser("sa5-o@x.io");
    const org = await createOrganization(owner.token);
    const cp = await createCounterparty(owner.token);
    await promoteToPlatformAdmin(admin.userId);

    const r = await inject(admin.token, "POST", "/api/v1/invoices", {
      organizationId: org.id,
      counterpartyId: cp.id,
      date: "2026-05-23",
      vatRate: 22,
      items: [{ name: "Услуга от админа", quantity: 1, price: 500, vatRate: 22 }],
    });
    expect(r.statusCode).toBe(201);

    // Invoice was persisted under org.userId (owner), not the admin
    const p = await getTestPrisma();
    const inv = await p.invoice.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(inv.userId).toBe(owner.userId);
  });

  it("admin still cannot remove the last OWNER (business invariant > admin bypass)", async () => {
    const admin = await registerUser("sa6-admin@x.io");
    const owner = await registerUser("sa6-o@x.io");
    const org = await createOrganization(owner.token);
    await promoteToPlatformAdmin(admin.userId);

    const p = await getTestPrisma();
    const ownerMember = await p.organizationMember.findFirstOrThrow({
      where: { organizationId: org.id, userId: owner.userId, role: "OWNER" },
    });

    const r = await inject(admin.token, "DELETE", `/api/v1/organizations/${org.id}/members/${ownerMember.id}`);
    expect(r.statusCode).toBe(409); // last-owner guard
  });

  it("admin reads a foreign org's contract templates (data:read via accessibleUserIds bypass)", async () => {
    const admin = await registerUser("sa7-admin@x.io");
    const owner = await registerUser("sa7-o@x.io");
    const org = await createOrganization(owner.token);

    // owner creates a template in their org
    const tplResp = await inject(owner.token, "POST", "/api/v1/contract-templates", {
      name: "Шаблон бухгалтера",
      content: "Договор {{contract.number}}",
      organizationId: org.id,
    });
    expect(tplResp.statusCode).toBe(201);
    const tplId = tplResp.json().id;

    await promoteToPlatformAdmin(admin.userId);

    // admin sees the template in list and can read it
    const list = await inject(admin.token, "GET", "/api/v1/contract-templates");
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((t: { id: string }) => t.id)).toContain(tplId);

    // admin can read single
    const get = await inject(admin.token, "GET", `/api/v1/contract-templates/${tplId}`);
    expect(get.statusCode).toBe(200);
  });

  it("admin gets 404 (not 200) for a truly non-existent organization id", async () => {
    const admin = await registerUser("sa8-admin@x.io");
    await promoteToPlatformAdmin(admin.userId);

    const fakeId = "00000000-0000-0000-0000-000000000000";
    const r = await inject(admin.token, "GET", `/api/v1/organizations/${fakeId}`);
    expect(r.statusCode).toBe(404);
  });
});
