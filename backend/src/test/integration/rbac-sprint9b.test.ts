// Sprint 9B: RBAC across the remaining routes — acts, upds, waybills,
// contracts, reconciliations, contract-templates.
//
// Each route is checked for: viewer read-only, viewer-cannot-write, accountant-
// can-write, cross-org privacy (404). Contract templates additionally check
// that ACCOUNTANT cannot manage templates (print:settings is ADMIN+).

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  addMember,
  closeAll,
  createCounterparty,
  createOrganization,
  getTestApp,
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

interface Setup {
  owner: { token: string; userId: string };
  admin: { token: string; userId: string };
  accountant: { token: string; userId: string };
  viewer: { token: string; userId: string };
  outsider: { token: string; userId: string };
  orgId: string;
  cpId: string;
}

async function setup(prefix: string): Promise<Setup> {
  const owner = await registerUser(`${prefix}-owner@x.io`);
  const admin = await registerUser(`${prefix}-admin@x.io`);
  const accountant = await registerUser(`${prefix}-acc@x.io`);
  const viewer = await registerUser(`${prefix}-v@x.io`);
  const outsider = await registerUser(`${prefix}-out@x.io`);
  const org = await createOrganization(owner.token);
  await addMember({ organizationId: org.id, userId: admin.userId, role: "ADMIN" });
  await addMember({ organizationId: org.id, userId: accountant.userId, role: "ACCOUNTANT" });
  await addMember({ organizationId: org.id, userId: viewer.userId, role: "VIEWER" });
  // Outsider has their own org so getAccessibleUserIds isn't empty-onboarding.
  // Use 5260200603 — a control-sum-valid юр. лицо ИНН distinct from the default 7707083893.
  await createOrganization(outsider.token, { inn: "5260200603", kpp: "526001001", name: "ООО Аут" });
  const cp = await createCounterparty(owner.token);
  return { owner, admin, accountant, viewer, outsider, orgId: org.id, cpId: cp.id };
}

function docPayload(orgId: string, cpId: string) {
  return {
    organizationId: orgId,
    counterpartyId: cpId,
    date: "2026-05-23",
    vatRate: 22,
    items: [{ name: "Услуга", quantity: 1, price: 1000, vatRate: 22 }],
  };
}

async function createDoc(token: string, url: string, payload: unknown) {
  const app = await getTestApp();
  return app.inject({
    method: "POST",
    url,
    headers: { Authorization: `Bearer ${token}` },
    payload,
  });
}

describe("Sprint 9B RBAC — acts", () => {
  it("VIEWER can read, cannot create; ACCOUNTANT can create; outsider gets 404", async () => {
    const s = await setup("acts");
    const app = await getTestApp();
    const url = "/api/v1/acts";
    const payload = docPayload(s.orgId, s.cpId);

    // VIEWER cannot create
    const vCreate = await createDoc(s.viewer.token, url, payload);
    expect(vCreate.statusCode).toBe(403);

    // ACCOUNTANT creates OK
    const aCreate = await createDoc(s.accountant.token, url, payload);
    expect(aCreate.statusCode).toBe(201);
    const actId = aCreate.json().id;

    // VIEWER reads list OK and sees the new act
    const vList = await app.inject({ method: "GET", url, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vList.statusCode).toBe(200);
    expect(vList.json().items.find((x: { id: string }) => x.id === actId)).toBeTruthy();

    // VIEWER reads one OK
    const vGet = await app.inject({ method: "GET", url: `${url}/${actId}`, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vGet.statusCode).toBe(200);

    // Outsider — 404 privacy (single)
    const oGet = await app.inject({ method: "GET", url: `${url}/${actId}`, headers: { Authorization: `Bearer ${s.outsider.token}` } });
    expect(oGet.statusCode).toBe(404);

    // Outsider — list does NOT contain the act
    const oList = await app.inject({ method: "GET", url, headers: { Authorization: `Bearer ${s.outsider.token}` } });
    expect(oList.statusCode).toBe(200);
    expect(oList.json().items.find((x: { id: string }) => x.id === actId)).toBeFalsy();

    // Outsider cannot patch/delete (privacy → org not found → 404)
    const oPatch = await app.inject({
      method: "PATCH",
      url: `${url}/${actId}`,
      headers: { Authorization: `Bearer ${s.outsider.token}` },
      payload: { notes: "hack" },
    });
    expect(oPatch.statusCode).toBe(404);

    // VIEWER cannot patch (403)
    const vPatch = await app.inject({
      method: "PATCH",
      url: `${url}/${actId}`,
      headers: { Authorization: `Bearer ${s.viewer.token}` },
      payload: { notes: "no" },
    });
    expect(vPatch.statusCode).toBe(403);

    // VIEWER cannot delete (403)
    const vDel = await app.inject({
      method: "DELETE",
      url: `${url}/${actId}`,
      headers: { Authorization: `Bearer ${s.viewer.token}` },
    });
    expect(vDel.statusCode).toBe(403);

    // ACCOUNTANT can patch/delete
    const aPatch = await app.inject({
      method: "PATCH",
      url: `${url}/${actId}`,
      headers: { Authorization: `Bearer ${s.accountant.token}` },
      payload: { notes: "edited" },
    });
    expect(aPatch.statusCode).toBe(200);
  });
});

describe("Sprint 9B RBAC — upds", () => {
  it("VIEWER cannot create; ACCOUNTANT can; outsider 404", async () => {
    const s = await setup("upds");
    const url = "/api/v1/upds";
    const payload = docPayload(s.orgId, s.cpId);

    const v = await createDoc(s.viewer.token, url, payload);
    expect(v.statusCode).toBe(403);

    const a = await createDoc(s.accountant.token, url, payload);
    expect(a.statusCode).toBe(201);
    const updId = a.json().id;

    const app = await getTestApp();
    const oGet = await app.inject({ method: "GET", url: `${url}/${updId}`, headers: { Authorization: `Bearer ${s.outsider.token}` } });
    expect(oGet.statusCode).toBe(404);

    const vList = await app.inject({ method: "GET", url, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vList.statusCode).toBe(200);
    expect(vList.json().items.find((x: { id: string }) => x.id === updId)).toBeTruthy();
  });
});

describe("Sprint 9B RBAC — waybills", () => {
  it("VIEWER cannot create; ACCOUNTANT can; outsider 404", async () => {
    const s = await setup("wb");
    const url = "/api/v1/waybills";
    const payload = docPayload(s.orgId, s.cpId);

    const v = await createDoc(s.viewer.token, url, payload);
    expect(v.statusCode).toBe(403);

    const a = await createDoc(s.accountant.token, url, payload);
    expect(a.statusCode).toBe(201);
    const wbId = a.json().id;

    const app = await getTestApp();
    const oGet = await app.inject({ method: "GET", url: `${url}/${wbId}`, headers: { Authorization: `Bearer ${s.outsider.token}` } });
    expect(oGet.statusCode).toBe(404);

    const vGet = await app.inject({ method: "GET", url: `${url}/${wbId}`, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vGet.statusCode).toBe(200);
  });
});

describe("Sprint 9B RBAC — contracts", () => {
  it("VIEWER cannot create; ACCOUNTANT can; outsider 404", async () => {
    const s = await setup("ct");
    const app = await getTestApp();
    const url = "/api/v1/contracts";
    const payload = {
      organizationId: s.orgId,
      counterpartyId: s.cpId,
      number: "Д-9B-001/2026",
      date: "2026-05-23",
      subject: "Услуги",
    };

    const v = await createDoc(s.viewer.token, url, payload);
    expect(v.statusCode).toBe(403);

    const a = await createDoc(s.accountant.token, url, payload);
    expect(a.statusCode).toBe(201);
    const id = a.json().id;

    // Outsider blanket-blocked
    const oGet = await app.inject({ method: "GET", url: `${url}/${id}`, headers: { Authorization: `Bearer ${s.outsider.token}` } });
    expect(oGet.statusCode).toBe(404);
    const oPdf = await app.inject({ method: "GET", url: `${url}/${id}/pdf`, headers: { Authorization: `Bearer ${s.outsider.token}` } });
    expect(oPdf.statusCode).toBe(404);

    // VIEWER read OK
    const vGet = await app.inject({ method: "GET", url: `${url}/${id}`, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vGet.statusCode).toBe(200);

    // ACCOUNTANT patch OK
    const aPatch = await app.inject({
      method: "PATCH",
      url: `${url}/${id}`,
      headers: { Authorization: `Bearer ${s.accountant.token}` },
      payload: { subject: "Услуги (изменено)" },
    });
    expect(aPatch.statusCode).toBe(200);

    // VIEWER patch denied
    const vPatch = await app.inject({
      method: "PATCH",
      url: `${url}/${id}`,
      headers: { Authorization: `Bearer ${s.viewer.token}` },
      payload: { subject: "no" },
    });
    expect(vPatch.statusCode).toBe(403);
  });
});

describe("Sprint 9B RBAC — reconciliations", () => {
  it("VIEWER can preview/list/get; cannot persist. ACCOUNTANT can. Outsider 404", async () => {
    const s = await setup("rec");
    const app = await getTestApp();
    const url = "/api/v1/reconciliations";

    // Preview as VIEWER — allowed (data:read)
    const preview = await app.inject({
      method: "GET",
      url: `${url}/preview?organizationId=${s.orgId}&counterpartyId=${s.cpId}&periodFrom=2026-01-01&periodTo=2026-12-31`,
      headers: { Authorization: `Bearer ${s.viewer.token}` },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toHaveProperty("openingBalance");

    // Outsider preview — 404 (privacy on requireOrgAccess)
    const oPrev = await app.inject({
      method: "GET",
      url: `${url}/preview?organizationId=${s.orgId}&counterpartyId=${s.cpId}&periodFrom=2026-01-01&periodTo=2026-12-31`,
      headers: { Authorization: `Bearer ${s.outsider.token}` },
    });
    expect(oPrev.statusCode).toBe(404);

    const persistPayload = {
      organizationId: s.orgId,
      counterpartyId: s.cpId,
      periodFrom: "2026-01-01",
      periodTo: "2026-12-31",
    };

    // VIEWER cannot persist
    const v = await createDoc(s.viewer.token, url, persistPayload);
    expect(v.statusCode).toBe(403);

    // ACCOUNTANT can persist
    const a = await createDoc(s.accountant.token, url, persistPayload);
    expect(a.statusCode).toBe(201);
    const id = a.json().id;

    // VIEWER reads saved act OK
    const vGet = await app.inject({ method: "GET", url: `${url}/${id}`, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vGet.statusCode).toBe(200);

    // Outsider 404
    const oGet = await app.inject({ method: "GET", url: `${url}/${id}`, headers: { Authorization: `Bearer ${s.outsider.token}` } });
    expect(oGet.statusCode).toBe(404);

    // VIEWER cannot delete
    const vDel = await app.inject({ method: "DELETE", url: `${url}/${id}`, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vDel.statusCode).toBe(403);
  });
});

describe("Sprint 9B RBAC — contract-templates", () => {
  it("VIEWER can read; ACCOUNTANT cannot create (settings); ADMIN can; outsider 404", async () => {
    const s = await setup("tpl");
    const app = await getTestApp();
    const url = "/api/v1/contract-templates";
    const payload = {
      name: "Стандарт услуг",
      content: "Договор от {{contract.date}} между {{org.name}} и {{cp.name}}.",
      organizationId: s.orgId,
    };

    // ACCOUNTANT cannot create — print:settings is ADMIN+
    const aCreate = await createDoc(s.accountant.token, url, payload);
    expect(aCreate.statusCode).toBe(403);

    // VIEWER cannot create
    const vCreate = await createDoc(s.viewer.token, url, payload);
    expect(vCreate.statusCode).toBe(403);

    // ADMIN creates OK
    const adminCreate = await createDoc(s.admin.token, url, payload);
    expect(adminCreate.statusCode).toBe(201);
    const tplId = adminCreate.json().id;

    // VIEWER reads list and gets the template (data:read via accessibleUserIds)
    const vList = await app.inject({ method: "GET", url, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vList.statusCode).toBe(200);
    expect(vList.json().items.find((x: { id: string }) => x.id === tplId)).toBeTruthy();

    // VIEWER reads single
    const vGet = await app.inject({ method: "GET", url: `${url}/${tplId}`, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vGet.statusCode).toBe(200);

    // Outsider — template is owned by OWNER; outsider's accessibleUserIds doesn't include owner → 404
    const oGet = await app.inject({ method: "GET", url: `${url}/${tplId}`, headers: { Authorization: `Bearer ${s.outsider.token}` } });
    expect(oGet.statusCode).toBe(404);

    // ACCOUNTANT cannot patch
    const aPatch = await app.inject({
      method: "PATCH",
      url: `${url}/${tplId}`,
      headers: { Authorization: `Bearer ${s.accountant.token}` },
      payload: { name: "Новое имя" },
    });
    expect(aPatch.statusCode).toBe(403);

    // ADMIN can patch
    const adminPatch = await app.inject({
      method: "PATCH",
      url: `${url}/${tplId}`,
      headers: { Authorization: `Bearer ${s.admin.token}` },
      payload: { name: "Новое имя" },
    });
    expect(adminPatch.statusCode).toBe(200);

    // ACCOUNTANT cannot delete
    const aDel = await app.inject({ method: "DELETE", url: `${url}/${tplId}`, headers: { Authorization: `Bearer ${s.accountant.token}` } });
    expect(aDel.statusCode).toBe(403);

    // ADMIN can delete
    const adminDel = await app.inject({ method: "DELETE", url: `${url}/${tplId}`, headers: { Authorization: `Bearer ${s.admin.token}` } });
    expect(adminDel.statusCode).toBe(200);

    // /variables open to all authenticated
    const vars = await app.inject({ method: "GET", url: `${url}/variables`, headers: { Authorization: `Bearer ${s.viewer.token}` } });
    expect(vars.statusCode).toBe(200);
    expect(vars.json().variables.length).toBeGreaterThan(0);
  });

  it("/render-preview requires data:read for organizationId; outsider 404", async () => {
    const s = await setup("tplp");
    const app = await getTestApp();
    const url = "/api/v1/contract-templates/render-preview";

    const body = {
      content: "Договор {{contract.number}}",
      organizationId: s.orgId,
      counterpartyId: s.cpId,
      contract: { number: "Д-1", date: "2026-05-23", currency: "RUB", subject: "x" },
    };

    // VIEWER ok
    const v = await app.inject({
      method: "POST", url,
      headers: { Authorization: `Bearer ${s.viewer.token}` },
      payload: body,
    });
    expect(v.statusCode).toBe(200);

    // Outsider blocked
    const o = await app.inject({
      method: "POST", url,
      headers: { Authorization: `Bearer ${s.outsider.token}` },
      payload: body,
    });
    expect(o.statusCode).toBe(404);
  });
});
