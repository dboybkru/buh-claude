import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { innSchema, kppSchema, ogrnSchema, paginationSchema, parseSort, paginate } from "../lib/validators.js";

const orgTypeEnum = z.enum(["OOO", "AO", "PAO", "ZAO", "OAO", "IP"]);

const bankAccountJson = z
  .array(
    z.object({
      bankName: z.string(),
      bik: z.string().regex(/^04\d{7}$/),
      account: z.string().regex(/^\d{20}$/),
      corrAccount: z.string().regex(/^\d{20}$/),
      isDefault: z.boolean().optional(),
    }),
  )
  .optional()
  .nullable();

const baseShape = {
  type: orgTypeEnum,
  inn: innSchema,
  kpp: kppSchema.optional().nullable(),
  name: z.string().min(1).max(255),
  fullName: z.string().max(500).optional().nullable(),
  ogrn: ogrnSchema.optional().nullable(),
  okpo: z.string().optional().nullable(),
  legalAddress: z.string().optional().nullable(),
  actualAddress: z.string().optional().nullable(),
  managementName: z.string().optional().nullable(),
  managementPos: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("").transform(() => null)),
  phone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  bankAccounts: bankAccountJson,
  isActive: z.boolean().default(true),
  notes: z.string().optional().nullable(),
};

const createSchema = z.object(baseShape).superRefine((d, ctx) => {
  if (d.type !== "IP" && !d.kpp) ctx.addIssue({ code: "custom", path: ["kpp"], message: "КПП обязателен для юрлица" });
  if (d.type === "IP" && d.inn.length !== 12) ctx.addIssue({ code: "custom", path: ["inn"], message: "ИНН ИП — 12 цифр" });
  if (d.type !== "IP" && d.inn.length !== 10) ctx.addIssue({ code: "custom", path: ["inn"], message: "ИНН юрлица — 10 цифр" });
});

const updateSchema = z.object(baseShape).partial();

export async function counterpartiesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const where: Prisma.CounterpartyWhereInput = {
      userId,
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: "insensitive" } },
              { fullName: { contains: q.q, mode: "insensitive" } },
              { inn: { contains: q.q } },
            ],
          }
        : {}),
    };
    const orderBy = parseSort(q.sort, ["createdAt", "name", "inn"], { createdAt: "desc" });
    const [items, total] = await Promise.all([
      prisma.counterparty.findMany({
        where,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy,
      }),
      prisma.counterparty.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const cp = await prisma.counterparty.findFirst({ where: { id, userId: request.user.sub } });
    if (!cp) return reply.code(404).send({ error: "NotFound" });
    return cp;
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    try {
      const data = { ...parsed.data, userId: request.user.sub } as Prisma.CounterpartyUncheckedCreateInput;
      const created = await prisma.counterparty.create({ data });
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Контрагент с таким ИНН уже существует" });
      }
      throw err;
    }
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const existing = await prisma.counterparty.findFirst({ where: { id, userId: request.user.sub } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    try {
      const updated = await prisma.counterparty.update({
        where: { id },
        data: parsed.data as Prisma.CounterpartyUncheckedUpdateInput,
      });
      return updated;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "ИНН уже занят другим контрагентом" });
      }
      throw err;
    }
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await prisma.counterparty.findFirst({ where: { id, userId: request.user.sub } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    try {
      await prisma.counterparty.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        return reply.code(409).send({ error: "Conflict", message: "Нельзя удалить: есть связанные документы или договоры" });
      }
      throw err;
    }
  });
}
