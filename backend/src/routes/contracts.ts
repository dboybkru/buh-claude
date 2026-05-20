import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";

const statusEnum = z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате ГГГГ-ММ-ДД");

const baseShape = {
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  number: z.string().min(1).max(64),
  date: dateString,
  expiryDate: dateString.optional().nullable(),
  subject: z.string().optional().nullable(),
  amount: z.coerce.number().min(0).optional().nullable(),
  currency: z.string().length(3).default("RUB"),
  status: statusEnum.default("ACTIVE"),
  autoRenew: z.boolean().default(false),
  description: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
};

const createSchema = z.object(baseShape);
const updateSchema = z.object(baseShape).partial();

function transformDates<T extends Record<string, unknown>>(d: T): T {
  const result: Record<string, unknown> = { ...d };
  if (typeof result.date === "string") result.date = new Date(result.date);
  if (typeof result.expiryDate === "string") result.expiryDate = new Date(result.expiryDate);
  return result as T;
}

async function ensureRefsBelongToUser(userId: string, organizationId?: string, counterpartyId?: string) {
  if (organizationId) {
    const org = await prisma.organization.findFirst({ where: { id: organizationId, userId } });
    if (!org) return "Организация не найдена или принадлежит другому пользователю";
  }
  if (counterpartyId) {
    const cp = await prisma.counterparty.findFirst({ where: { id: counterpartyId, userId } });
    if (!cp) return "Контрагент не найден или принадлежит другому пользователю";
  }
  return null;
}

export async function contractsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const where: Prisma.ContractWhereInput = {
      userId,
      ...(q.q
        ? {
            OR: [
              { number: { contains: q.q, mode: "insensitive" } },
              { subject: { contains: q.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const orderBy = parseSort(q.sort, ["createdAt", "date", "number"], { date: "desc" });
    const [items, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy,
        include: {
          organization: { select: { id: true, name: true, inn: true } },
          counterparty: { select: { id: true, name: true, inn: true } },
        },
      }),
      prisma.contract.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const c = await prisma.contract.findFirst({
      where: { id, userId: request.user.sub },
      include: { organization: true, counterparty: true },
    });
    if (!c) return reply.code(404).send({ error: "NotFound" });
    return c;
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const userId = request.user.sub;
    const refErr = await ensureRefsBelongToUser(userId, parsed.data.organizationId, parsed.data.counterpartyId);
    if (refErr) return reply.code(400).send({ error: "ValidationError", message: refErr });
    try {
      const created = await prisma.contract.create({
        data: { ...transformDates(parsed.data), userId } as Prisma.ContractUncheckedCreateInput,
      });
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Договор с таким номером уже существует" });
      }
      throw err;
    }
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const userId = request.user.sub;
    const existing = await prisma.contract.findFirst({ where: { id, userId } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    const refErr = await ensureRefsBelongToUser(userId, parsed.data.organizationId, parsed.data.counterpartyId);
    if (refErr) return reply.code(400).send({ error: "ValidationError", message: refErr });
    try {
      const updated = await prisma.contract.update({
        where: { id },
        data: transformDates(parsed.data) as Prisma.ContractUncheckedUpdateInput,
      });
      return updated;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Номер договора занят" });
      }
      throw err;
    }
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await prisma.contract.findFirst({ where: { id, userId: request.user.sub } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    try {
      await prisma.contract.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        return reply.code(409).send({ error: "Conflict", message: "Нельзя удалить: есть связанные документы" });
      }
      throw err;
    }
  });
}
