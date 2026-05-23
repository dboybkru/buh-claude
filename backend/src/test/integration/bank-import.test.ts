import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getTestApp, resetDb, closeAll,
  registerUser, createOrganization, createCounterparty,
} from "../setup.js";
import { buildMultipart } from "../helpers/multipart.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX_DIR = resolve(HERE, "..", "fixtures", "bank-statements");

describe("Bank statement import", () => {
  beforeAll(async () => { await getTestApp(); });
  afterAll(async () => { await closeAll(); });
  beforeEach(async () => { await resetDb(); });

  async function createInvoice(
    token: string, orgId: string, cpId: string, number: string, total: number,
  ): Promise<string> {
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        organizationId: orgId, counterpartyId: cpId, number,
        date: "2026-05-20", vatRate: 22, vatIncluded: true, status: "SENT",
        items: [{ name: "Услуга", unit: "шт", unitCode: "796", quantity: 1, price: total, vatRate: 22 }],
      },
    });
    if (r.statusCode !== 201) throw new Error(`createInvoice failed: ${r.statusCode} ${r.body}`);
    return r.json().id;
  }

  async function preview(token: string, orgId: string, fileName: string, buf: Buffer) {
    const app = await getTestApp();
    const { body, contentType } = buildMultipart([
      { name: "organizationId", value: orgId },
      { name: "file", filename: fileName, contentType: "text/csv", value: buf },
    ]);
    return app.inject({
      method: "POST",
      url: "/api/v1/bank-import/preview",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      payload: body,
    });
  }

  it("preview CSV: парсит строки, находит контрагента по ИНН, ищет счёт по номеру в назначении", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);  // ИНН 7728168971
    await createInvoice(token, org.id, cp.id, "СЧ-0001/2026", 60000);

    const csv = readFileSync(resolve(FIX_DIR, "basic.csv"));
    const r = await preview(token, org.id, "basic.csv", csv);
    expect(r.statusCode).toBe(200);

    const body = r.json();
    expect(body.importId).toBeTruthy();
    expect(body.rows.length).toBe(4);

    const row1 = body.rows[0];
    expect(row1.date).toBe("2026-06-01");
    expect(row1.amount).toBe(60000);
    expect(row1.direction).toBe("IN");
    expect(row1.counterpartyInn).toBe("7728168971");
    expect(row1.suggestedCounterpartyId).toBe(cp.id);
    expect(row1.suggestedInvoiceAllocations).toHaveLength(1);
    expect(row1.suggestedInvoiceAllocations[0].invoiceNumber).toBe("СЧ-0001/2026");
    expect(row1.suggestedInvoiceAllocations[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(row1.status).toBe("ready");

    const row2 = body.rows[1];  // 100000 на того же контрагента, счета нет — должен быть needs_review (аванс)
    expect(row2.direction).toBe("IN");
    expect(row2.suggestedCounterpartyId).toBe(cp.id);
    expect(row2.status).toBe("needs_review");

    const row3 = body.rows[2];  // OUT, ИНН чужой
    expect(row3.direction).toBe("OUT");
    expect(row3.amount).toBe(15000);

    const row4 = body.rows[3];  // битая сумма
    expect(row4.errors.length).toBeGreaterThan(0);
    expect(row4.status).toBe("error");

    expect(body.summary.totalRows).toBe(4);
    expect(body.summary.errors).toBe(1);
    expect(body.summary.totalIncome).toBe(160000);  // 60k + 100k
    expect(body.summary.totalExpense).toBe(15000);
  });

  it("preview XLSX: smoke — файл читается и нормализуется", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    await createInvoice(token, org.id, cp.id, "СЧ-0001/2026", 60000);

    const xlsx = readFileSync(resolve(FIX_DIR, "basic.xlsx"));
    const app = await getTestApp();
    const { body, contentType } = buildMultipart([
      { name: "organizationId", value: org.id },
      { name: "file", filename: "basic.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", value: xlsx },
    ]);
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/bank-import/preview",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      payload: body,
    });
    expect(r.statusCode).toBe(200);
    const json = r.json();
    expect(json.rows.length).toBe(2);
    expect(json.rows[0].direction).toBe("IN");
    expect(json.rows[1].direction).toBe("OUT");
  });

  it("confirm: создаёт Payment + Allocation, остаток уходит в аванс", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const invId = await createInvoice(token, org.id, cp.id, "СЧ-0001/2026", 60000);

    const csv = readFileSync(resolve(FIX_DIR, "basic.csv"));
    const pr = await preview(token, org.id, "basic.csv", csv);
    const { importId, rows } = pr.json();

    // Импортируем строку 1 (точное совпадение со счётом) и строку 2 как аванс (без allocations)
    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/bank-import/confirm",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        importId,
        rows: [
          {
            rowNumber: rows[0].rowNumber, action: "import",
            counterpartyId: rows[0].suggestedCounterpartyId,
            date: rows[0].date, amount: rows[0].amount, direction: "IN",
            purpose: rows[0].purpose, reference: rows[0].reference,
            allocations: [{ invoiceId: invId, amount: 60000 }],
          },
          {
            rowNumber: rows[1].rowNumber, action: "import",
            counterpartyId: rows[1].suggestedCounterpartyId,
            date: rows[1].date, amount: rows[1].amount, direction: "IN",
            purpose: rows[1].purpose, reference: rows[1].reference,
            allocations: [],  // полностью аванс
          },
          { rowNumber: rows[2].rowNumber, action: "skip", date: rows[2].date ?? "2026-06-05", amount: rows[2].amount ?? 1, direction: "OUT" },
          { rowNumber: rows[3].rowNumber, action: "skip", date: "2026-06-10", amount: 1, direction: "IN" },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.createdPayments).toHaveLength(2);
    expect(body.errors).toHaveLength(0);
    expect(body.skippedRows.length).toBe(2);

    // Проверим, что счёт стал PAID
    const inv = await app.inject({ method: "GET", url: `/api/v1/invoices/${invId}`, headers: { Authorization: `Bearer ${token}` } });
    expect(inv.json().status).toBe("PAID");

    // Проверим, что у второго платежа есть unallocatedAmount=100000 (аванс)
    const list = await app.inject({ method: "GET", url: "/api/v1/payments", headers: { Authorization: `Bearer ${token}` } });
    const items = list.json().items as Array<{ amount: string; unallocatedAmount?: number }>;
    const advance = items.find((p) => Number(p.amount) === 100000);
    expect(advance?.unallocatedAmount).toBe(100000);
  });

  it("confirm: дубль не создаётся повторно", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const invId = await createInvoice(token, org.id, cp.id, "СЧ-0001/2026", 60000);

    const csv = readFileSync(resolve(FIX_DIR, "basic.csv"));
    const pr1 = await preview(token, org.id, "basic.csv", csv);
    const row = pr1.json().rows[0];

    const app = await getTestApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/bank-import/confirm",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        importId: pr1.json().importId,
        rows: [{
          rowNumber: row.rowNumber, action: "import",
          counterpartyId: row.suggestedCounterpartyId,
          date: row.date, amount: row.amount, direction: "IN",
          purpose: row.purpose, reference: row.reference,
          allocations: [{ invoiceId: invId, amount: 60000 }],
        }],
      },
    });

    // Повторный импорт того же файла — ту же строку confirm не должен создать дважды
    const pr2 = await preview(token, org.id, "basic.csv", csv);
    const row2 = pr2.json().rows[0];
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/bank-import/confirm",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        importId: pr2.json().importId,
        rows: [{
          rowNumber: row2.rowNumber, action: "import",
          counterpartyId: row2.suggestedCounterpartyId,
          date: row2.date, amount: row2.amount, direction: "IN",
          purpose: row2.purpose, reference: row2.reference,
          allocations: [],  // даже без allocations дубль по reference+date+amount
        }],
      },
    });
    const body = r2.json();
    expect(body.createdPayments).toHaveLength(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toMatch(/Дубликат/);
  });

  it("confirm: ошибка в одной строке не откатывает остальные", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const invId = await createInvoice(token, org.id, cp.id, "СЧ-0001/2026", 60000);

    const csv = readFileSync(resolve(FIX_DIR, "basic.csv"));
    const pr = await preview(token, org.id, "basic.csv", csv);
    const { importId, rows } = pr.json();

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/bank-import/confirm",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        importId,
        rows: [
          // первый — валидный, должен пройти
          {
            rowNumber: rows[0].rowNumber, action: "import",
            counterpartyId: rows[0].suggestedCounterpartyId,
            date: rows[0].date, amount: rows[0].amount, direction: "IN",
            purpose: rows[0].purpose, reference: rows[0].reference,
            allocations: [{ invoiceId: invId, amount: 60000 }],
          },
          // второй — намеренно сломаем: allocation > amount
          {
            rowNumber: rows[1].rowNumber, action: "import",
            counterpartyId: rows[1].suggestedCounterpartyId,
            date: rows[1].date, amount: rows[1].amount, direction: "IN",
            purpose: rows[1].purpose, reference: rows[1].reference,
            allocations: [{ invoiceId: invId, amount: 999999 }],  // больше суммы платежа
          },
        ],
      },
    });
    const body = r.json();
    expect(body.createdPayments).toHaveLength(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].rowNumber).toBe(rows[1].rowNumber);
  });

  it("confirm: OUT-платёж получает allocations → ошибка", async () => {
    const { token } = await registerUser();
    const org = await createOrganization(token);
    const cp = await createCounterparty(token);
    const invId = await createInvoice(token, org.id, cp.id, "СЧ-0001/2026", 5000);

    const csv = readFileSync(resolve(FIX_DIR, "basic.csv"));
    const pr = await preview(token, org.id, "basic.csv", csv);
    const { importId } = pr.json();

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/bank-import/confirm",
      headers: { Authorization: `Bearer ${token}` },
      payload: {
        importId,
        rows: [
          {
            rowNumber: 99, action: "import",
            counterpartyId: cp.id,
            date: "2026-06-05", amount: 1000, direction: "OUT",
            purpose: "Расход", reference: "OUT1",
            allocations: [{ invoiceId: invId, amount: 1000 }],
          },
        ],
      },
    });
    const body = r.json();
    expect(body.createdPayments).toHaveLength(0);
    expect(body.errors[0].message).toMatch(/OUT/);
  });

  it("security: чужая организация — 404 на preview (Sprint 9 privacy)", async () => {
    const { token: t1 } = await registerUser("user1@test.local");
    const { token: t2 } = await registerUser("user2@test.local");
    const org2 = await createOrganization(t2);

    const csv = readFileSync(resolve(FIX_DIR, "basic.csv"));
    const r = await preview(t1, org2.id, "basic.csv", csv);
    // requireOrgAccess returns 404 (privacy) before file validation.
    expect(r.statusCode).toBe(404);
  });

  it("security: импорт на чужой invoiceId — ошибка", async () => {
    const { token: t1 } = await registerUser("user1@test.local");
    const { token: t2 } = await registerUser("user2@test.local");
    const org1 = await createOrganization(t1);
    const cp1 = await createCounterparty(t1);
    const org2 = await createOrganization(t2);
    const cp2 = await createCounterparty(t2);
    const foreignInv = await createInvoice(t2, org2.id, cp2.id, "СЧ-FOREIGN/2026", 5000);

    const csv = readFileSync(resolve(FIX_DIR, "basic.csv"));
    const pr = await preview(t1, org1.id, "basic.csv", csv);
    const { importId } = pr.json();

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/bank-import/confirm",
      headers: { Authorization: `Bearer ${t1}` },
      payload: {
        importId,
        rows: [{
          rowNumber: 99, action: "import",
          counterpartyId: cp1.id,
          date: "2026-06-15", amount: 5000, direction: "IN",
          purpose: "Левый", reference: "X1",
          allocations: [{ invoiceId: foreignInv, amount: 5000 }],
        }],
      },
    });
    const body = r.json();
    expect(body.createdPayments).toHaveLength(0);
    expect(body.errors.length).toBe(1);
  });

  it("security: importId другого пользователя — ошибка валидации", async () => {
    const { token: t1 } = await registerUser("user1@test.local");
    const { token: t2 } = await registerUser("user2@test.local");
    const org1 = await createOrganization(t1);

    const csv = readFileSync(resolve(FIX_DIR, "basic.csv"));
    const pr = await preview(t1, org1.id, "basic.csv", csv);
    const { importId } = pr.json();

    const app = await getTestApp();
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/bank-import/confirm",
      headers: { Authorization: `Bearer ${t2}` },
      payload: {
        importId,
        rows: [{ rowNumber: 1, action: "skip", date: "2026-01-01", amount: 1, direction: "IN" }],
      },
    });
    expect(r.statusCode).toBe(400);  // preview not found for this user
  });
});
