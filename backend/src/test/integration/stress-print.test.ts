// Sprint 5.1: stress integration — счёт с большим количеством позиций
// и длинными названиями не ломает PDF/preview endpoints.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestApp, resetDb, closeAll, registerUser, createOrganization, createCounterparty } from "../setup.js";

describe("Stress print: длинные данные не ломают PDF/preview", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  async function createBigInvoice(token: string, orgId: string, cpId: string) {
    const app = await getTestApp();
    const items = Array.from({ length: 17 }, (_, i) => ({
      name: `Услуга №${i + 1} — длинное название с описанием сценария оказания услуги, расширенным SLA и приложениями — версия ${i + 1}`,
      unit: i % 3 === 0 ? "ч" : "шт",
      unitCode: "796",
      quantity: (i % 4) + 1,
      price: 1500 + i * 137,
      vatRate: 22,
    }));
    return app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: orgId,
        counterpartyId: cpId,
        date: "2026-05-21",
        vatRate: 22,
        vatIncluded: true,
        items,
      },
    });
  }

  it("PDF многопозиционного счёта генерируется (>10 KB) и не падает", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token, {
      fullName: "Общество с ограниченной ответственностью «Альфа-Технология-Сервис производственно-коммерческое предприятие»",
      legalAddress: "117997, г. Москва, Юго-Западный административный округ, ул. Вавилова, дом 19, корпус 2",
    });
    const cp = await createCounterparty(token, {
      fullName: "Общество с ограниченной ответственностью «Бета-Промышленные-Решения-Восточной-Сибири»",
      legalAddress: "664047, Иркутская обл., г. Иркутск, ул. Декабрьских Событий, д. 78А",
    });
    const inv = (await createBigInvoice(token, org.id, cp.id)).json();

    const app = await getTestApp();
    const pdf = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${inv.id}/pdf`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    // PDF с 17 позициями и кириллическим шрифтом весит ~50+ KB
    expect(pdf.rawPayload.length).toBeGreaterThan(10_000);
    // PDF magic header
    expect(pdf.rawPayload.slice(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("HTML preview многопозиционного счёта содержит экранированные данные", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const inv = (await createBigInvoice(token, org.id, cp.id)).json();

    const app = await getTestApp();
    const html = await app.inject({
      method: "GET",
      url: `/api/v1/invoices/${inv.id}/preview`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toMatch(/text\/html/);
    expect(html.body).toContain("Услуга №1");
    expect(html.body).toContain("Услуга №17");
  });

  it("счёт без НДС — preview содержит «Без НДС», PDF не падает", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token, { vatMode: "EXEMPT" });
    const cp = await createCounterparty(token);
    const app = await getTestApp();
    const inv = (await app.inject({
      method: "POST", url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: org.id, counterpartyId: cp.id,
        date: "2026-05-21", vatRate: 0, vatIncluded: true,
        items: [{ name: "Услуга без НДС", unit: "шт", unitCode: "796", quantity: 1, price: 1000, vatRate: 0 }],
      },
    })).json();

    const html = await app.inject({
      method: "GET", url: `/api/v1/invoices/${inv.id}/preview`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(html.statusCode).toBe(200);
    expect(html.body).toMatch(/Без НДС/);

    const pdf = await app.inject({
      method: "GET", url: `/api/v1/invoices/${inv.id}/pdf`,
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.slice(0, 4).toString("latin1")).toBe("%PDF");
  });
});
