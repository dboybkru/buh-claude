import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";
import { nextDocumentNumber } from "../lib/numbering.js";
import { itemInputSchema, prepareItems, itemCreateData } from "../lib/document-items.js";
import { isInvoiceStatusLocked } from "../lib/document-status.js";

const statusEnum = z.enum(["DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "CANCELLED", "OVERDUE"]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате ГГГГ-ММ-ДД");

const baseFields = {
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  contractId: z.string().uuid().optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  date: dateString,
  dueDate: dateString.optional().nullable(),
  currency: z.string().length(3).default("RUB"),
  status: statusEnum.optional(),
  vatRate: z.coerce.number().min(0).max(99.99).default(20),
  vatIncluded: z.boolean().default(true),
  paymentPurpose: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
};

const createSchema = z.object({
  ...baseFields,
  number: z.string().optional(), // если не передан — автонумерация
  items: z.array(itemInputSchema).min(1, "Документ должен содержать хотя бы одну позицию"),
});

const updateSchema = z.object({
  ...baseFields,
  number: z.string().optional(),
  items: z.array(itemInputSchema).min(1).optional(),
  paidAt: z.string().datetime().optional().nullable(),
}).partial();

function toDate(s: string | null | undefined): Date | null | undefined {
  if (s == null) return s;
  return new Date(s);
}

export async function invoicesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const where: Prisma.InvoiceWhereInput = {
      userId,
      ...(q.q ? { OR: [
        { number: { contains: q.q, mode: "insensitive" } },
        { counterparty: { name: { contains: q.q, mode: "insensitive" } } },
      ] } : {}),
    };
    const orderBy = parseSort(q.sort, ["createdAt", "date", "number", "total"], { date: "desc" });
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy,
        include: {
          organization: { select: { id: true, name: true } },
          counterparty: { select: { id: true, name: true, inn: true } },
        },
      }),
      prisma.invoice.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const inv = await prisma.invoice.findFirst({
      where: { id, userId: request.user.sub },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
        contract: true,
        bankAccount: true,
        items: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!inv) return reply.code(404).send({ error: "NotFound" });
    return inv;
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const userId = request.user.sub;
    const data = parsed.data;

    const [org, cp] = await Promise.all([
      prisma.organization.findFirst({ where: { id: data.organizationId, userId } }),
      prisma.counterparty.findFirst({ where: { id: data.counterpartyId, userId } }),
    ]);
    if (!org) return reply.code(400).send({ error: "ValidationError", message: "Организация не найдена" });
    if (!cp) return reply.code(400).send({ error: "ValidationError", message: "Контрагент не найден" });

    const { prepared, totals } = prepareItems(data.items, data.vatIncluded);
    const year = new Date(data.date).getFullYear();

    try {
      const created = await prisma.$transaction(async (tx) => {
        const number = data.number ?? (await nextDocumentNumber(tx, userId, data.organizationId, "INVOICE", year));
        const inv = await tx.invoice.create({
          data: {
            userId,
            organizationId: data.organizationId,
            counterpartyId: data.counterpartyId,
            contractId: data.contractId ?? null,
            bankAccountId: data.bankAccountId ?? null,
            number,
            date: new Date(data.date),
            dueDate: toDate(data.dueDate),
            currency: data.currency,
            status: data.status ?? "DRAFT",
            vatRate: data.vatRate,
            vatIncluded: data.vatIncluded,
            subtotal: Number(totals.subtotal),
            vatAmount: Number(totals.vatAmount),
            total: Number(totals.total),
            paymentPurpose: data.paymentPurpose ?? null,
            notes: data.notes ?? null,
          },
        });
        await tx.documentItem.createMany({
          data: prepared.map((it) => itemCreateData(it, userId, "INVOICE", inv.id)),
        });
        return inv;
      });
      const full = await prisma.invoice.findUnique({
        where: { id: created.id },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      });
      return reply.code(201).send(full);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Счёт с таким номером уже существует" });
      }
      throw err;
    }
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const userId = request.user.sub;
    const existing = await prisma.invoice.findFirst({ where: { id, userId } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    if (isInvoiceStatusLocked(existing.status)) {
      return reply.code(409).send({
        error: "Locked",
        message: `Счёт в статусе ${existing.status} нельзя редактировать. Создайте исправление или верните в DRAFT.`,
      });
    }
    const data = parsed.data;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const vatIncluded = data.vatIncluded ?? existing.vatIncluded;
        let subtotal: number | undefined;
        let vatAmount: number | undefined;
        let total: number | undefined;

        if (data.items) {
          const { prepared, totals } = prepareItems(data.items, vatIncluded);
          await tx.documentItem.deleteMany({ where: { invoiceId: id } });
          await tx.documentItem.createMany({
            data: prepared.map((it) => itemCreateData(it, userId, "INVOICE", id)),
          });
          subtotal = Number(totals.subtotal);
          vatAmount = Number(totals.vatAmount);
          total = Number(totals.total);
        }

        return tx.invoice.update({
          where: { id },
          data: {
            ...(data.organizationId !== undefined ? { organizationId: data.organizationId } : {}),
            ...(data.counterpartyId !== undefined ? { counterpartyId: data.counterpartyId } : {}),
            ...(data.contractId !== undefined ? { contractId: data.contractId } : {}),
            ...(data.bankAccountId !== undefined ? { bankAccountId: data.bankAccountId } : {}),
            ...(data.number !== undefined ? { number: data.number } : {}),
            ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
            ...(data.dueDate !== undefined ? { dueDate: data.dueDate ? new Date(data.dueDate) : null } : {}),
            ...(data.currency !== undefined ? { currency: data.currency } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.vatRate !== undefined ? { vatRate: data.vatRate } : {}),
            ...(data.vatIncluded !== undefined ? { vatIncluded: data.vatIncluded } : {}),
            ...(data.paymentPurpose !== undefined ? { paymentPurpose: data.paymentPurpose } : {}),
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
            ...(data.paidAt !== undefined ? { paidAt: data.paidAt ? new Date(data.paidAt) : null } : {}),
            ...(subtotal !== undefined ? { subtotal, vatAmount, total } : {}),
          },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
      });
      return updated;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Номер занят другим счётом" });
      }
      throw err;
    }
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await prisma.invoice.findFirst({ where: { id, userId: request.user.sub } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    if (isInvoiceStatusLocked(existing.status)) {
      return reply.code(409).send({ error: "Locked", message: `Счёт в статусе ${existing.status} нельзя удалить` });
    }
    await prisma.invoice.delete({ where: { id } });
    return { ok: true };
  });
}
