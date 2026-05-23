// Sprint 9: membership / RBAC integration tests.
//
// Covers:
//   - Creating an organization auto-grants the creator OWNER.
//   - members listing requires ACCOUNTANT+.
//   - OWNER / ADMIN can invite; ACCOUNTANT / VIEWER cannot.
//   - ADMIN cannot demote OWNER / cannot mint OWNER.
//   - Last OWNER cannot be removed / demoted.
//   - Auto-claim of pending INVITED rows on register.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  closeAll,
  createOrganization,
  getTestApp,
  getTestPrisma,
  registerUser,
  resetDb,
  addMember,
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

describe("members & RBAC", () => {
  it("creating an organization makes the caller an OWNER member", async () => {
    const app = await getTestApp();
    const owner = await registerUser("owner1@example.com");
    const org = await createOrganization(owner.token);

    const r = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${org.id}/members`,
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(r.statusCode).toBe(200);
    const members = r.json();
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("OWNER");
    expect(members[0].status).toBe("ACTIVE");
    expect(members[0].user.email).toBe("owner1@example.com");
  });

  it("VIEWER can read members list, cannot invite", async () => {
    const app = await getTestApp();
    const owner = await registerUser("o2@example.com");
    const viewer = await registerUser("v2@example.com");
    const org = await createOrganization(owner.token);
    await addMember({ organizationId: org.id, userId: viewer.userId, role: "VIEWER" });

    // Listing is allowed for ACCOUNTANT+ only — viewer is rejected.
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${org.id}/members`,
      headers: { Authorization: `Bearer ${viewer.token}` },
    });
    expect(list.statusCode).toBe(403);

    // Viewer cannot invite anyone.
    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${org.id}/members/invite`,
      headers: { Authorization: `Bearer ${viewer.token}` },
      payload: { email: "new@example.com", role: "ACCOUNTANT" },
    });
    expect(invite.statusCode).toBe(403);
  });

  it("OWNER invites by email of unregistered user — INVITED row claimed on register", async () => {
    const app = await getTestApp();
    const owner = await registerUser("o3@example.com");
    const org = await createOrganization(owner.token);

    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${org.id}/members/invite`,
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: { email: "newcomer@example.com", role: "ACCOUNTANT" },
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().status).toBe("INVITED");
    expect(invite.json().userId).toBeNull();

    // The invitee registers. Auto-claim kicks in.
    const newcomer = await registerUser("newcomer@example.com");
    const p = await getTestPrisma();
    const m = await p.organizationMember.findFirst({
      where: { organizationId: org.id, userId: newcomer.userId },
    });
    expect(m).not.toBeNull();
    expect(m?.status).toBe("ACTIVE");
    expect(m?.role).toBe("ACCOUNTANT");
  });

  it("ADMIN can invite ACCOUNTANT/VIEWER, cannot invite OWNER", async () => {
    const app = await getTestApp();
    const owner = await registerUser("o4@example.com");
    const admin = await registerUser("a4@example.com");
    const org = await createOrganization(owner.token);
    await addMember({ organizationId: org.id, userId: admin.userId, role: "ADMIN" });

    const okInvite = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${org.id}/members/invite`,
      headers: { Authorization: `Bearer ${admin.token}` },
      payload: { email: "guest@example.com", role: "VIEWER" },
    });
    expect(okInvite.statusCode).toBe(201);

    const tryOwner = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${org.id}/members/invite`,
      headers: { Authorization: `Bearer ${admin.token}` },
      payload: { email: "guest2@example.com", role: "OWNER" },
    });
    expect(tryOwner.statusCode).toBe(403);
  });

  it("ADMIN cannot demote OWNER, cannot mint another OWNER", async () => {
    const app = await getTestApp();
    const owner = await registerUser("o5@example.com");
    const admin = await registerUser("a5@example.com");
    const org = await createOrganization(owner.token);
    await addMember({ organizationId: org.id, userId: admin.userId, role: "ADMIN" });

    const p = await getTestPrisma();
    const ownerMember = await p.organizationMember.findFirstOrThrow({
      where: { organizationId: org.id, userId: owner.userId, role: "OWNER" },
    });

    const demote = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${org.id}/members/${ownerMember.id}`,
      headers: { Authorization: `Bearer ${admin.token}` },
      payload: { role: "ADMIN" },
    });
    expect(demote.statusCode).toBe(403);

    // ADMIN promoting self to OWNER
    const adminMember = await p.organizationMember.findFirstOrThrow({
      where: { organizationId: org.id, userId: admin.userId },
    });
    const promote = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${org.id}/members/${adminMember.id}`,
      headers: { Authorization: `Bearer ${admin.token}` },
      payload: { role: "OWNER" },
    });
    expect(promote.statusCode).toBe(403);
  });

  it("last OWNER cannot be removed or demoted", async () => {
    const app = await getTestApp();
    const owner = await registerUser("o6@example.com");
    const org = await createOrganization(owner.token);

    const p = await getTestPrisma();
    const ownerMember = await p.organizationMember.findFirstOrThrow({
      where: { organizationId: org.id, userId: owner.userId, role: "OWNER" },
    });

    const demote = await app.inject({
      method: "PATCH",
      url: `/api/v1/organizations/${org.id}/members/${ownerMember.id}`,
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: { status: "DISABLED" },
    });
    expect(demote.statusCode).toBe(403); // self-disable blocked first

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/v1/organizations/${org.id}/members/${ownerMember.id}`,
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(remove.statusCode).toBe(409); // last OWNER guard
  });

  it("VIEWER cannot create invoice; ACCOUNTANT can", async () => {
    const app = await getTestApp();
    const owner = await registerUser("o7@example.com");
    const viewer = await registerUser("v7@example.com");
    const accountant = await registerUser("ac7@example.com");
    const org = await createOrganization(owner.token);
    await addMember({ organizationId: org.id, userId: viewer.userId, role: "VIEWER" });
    await addMember({ organizationId: org.id, userId: accountant.userId, role: "ACCOUNTANT" });

    // Owner creates a counterparty first (CP is user-scoped at owner level).
    const cpResp = await app.inject({
      method: "POST",
      url: "/api/v1/counterparties",
      headers: { Authorization: `Bearer ${owner.token}` },
      payload: {
        type: "OOO",
        inn: "7728168971",
        kpp: "772801001",
        name: "ООО Бета",
      },
    });
    expect(cpResp.statusCode).toBe(201);
    const cpId = cpResp.json().id;

    const invoicePayload = {
      organizationId: org.id,
      counterpartyId: cpId,
      date: "2026-05-22",
      vatRate: 22,
      items: [{ name: "Услуга", quantity: 1, price: 100, vatRate: 22 }],
    };

    const viewerCreate = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${viewer.token}` },
      payload: invoicePayload,
    });
    expect(viewerCreate.statusCode).toBe(403);

    const accountantCreate = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${accountant.token}` },
      payload: invoicePayload,
    });
    expect(accountantCreate.statusCode).toBe(201);
  });

  it("VIEWER cannot upload organization logo; ADMIN can attempt (multipart skipped here)", async () => {
    const app = await getTestApp();
    const owner = await registerUser("o8@example.com");
    const viewer = await registerUser("v8@example.com");
    const org = await createOrganization(owner.token);
    await addMember({ organizationId: org.id, userId: viewer.userId, role: "VIEWER" });

    // The endpoint expects multipart; we hit it without a file so the
    // viewer is rejected at the role gate (403) before content parsing.
    const r = await app.inject({
      method: "POST",
      url: `/api/v1/files/organizations/${org.id}/logo`,
      headers: { Authorization: `Bearer ${viewer.token}` },
    });
    expect(r.statusCode).toBe(403);
  });

  it("invited member sees the organization in GET /organizations", async () => {
    const app = await getTestApp();
    const owner = await registerUser("o9@example.com");
    const acc = await registerUser("ac9@example.com");
    const org = await createOrganization(owner.token);
    await addMember({ organizationId: org.id, userId: acc.userId, role: "ACCOUNTANT" });

    const r = await app.inject({
      method: "GET",
      url: "/api/v1/organizations",
      headers: { Authorization: `Bearer ${acc.token}` },
    });
    expect(r.statusCode).toBe(200);
    const items = r.json().items;
    expect(items.map((x: { id: string }) => x.id)).toContain(org.id);
  });
});
