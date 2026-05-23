import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";
import { assertCanWriteData, getAccessibleUserIds } from "../lib/org-access.js";

const nomenTypeEnum = z.enum(["TOVAR", "USLUGA", "RABOTA"]);

const baseShape = {
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  fullName: z.string().max(500).optional().nullable(),
  unitMeasure: z.string().default("шт"),
  unitCode: z.string().default("796"),
  type: nomenTypeEnum.default("TOVAR"),
  vatRate: z.coerce.number().min(0).max(99.99).default(20),
  price: z.coerce.number().min(0).optional().nullable(),
  isActive: z.boolean().default(true),
  description: z.string().optional().nullable(),
};

const createSchema = z.object(baseShape);
const updateSchema = z.object(baseShape).partial();

function toData<T extends Record<string, unknown>>(d: T) {
  return d;
}

export async function nomenclatureRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const userIds = await getAccessibleUserIds(prisma, request.user.sub);
    const where: Prisma.NomenclatureWhereInput = {
      userId: { in: userIds },
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: "insensitive" } },
              { code: { contains: q.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const orderBy = parseSort(q.sort, ["createdAt", "name", "code"], { name: "asc" });
    const [items, total] = await Promise.all([
      prisma.nomenclature.findMany({
        where,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy,
      }),
      prisma.nomenclature.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const userIds = await getAccessibleUserIds(prisma, request.user.sub);
    const n = await prisma.nomenclature.findFirst({ where: { id, userId: { in: userIds } } });
    if (!n) return reply.code(404).send({ error: "NotFound" });
    return n;
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    await assertCanWriteData(request.user.sub);
    try {
      const created = await prisma.nomenclature.create({
        data: { ...toData(parsed.data), userId: request.user.sub } as Prisma.NomenclatureUncheckedCreateInput,
      });
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Позиция с таким кодом уже существует" });
      }
      throw err;
    }
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    await assertCanWriteData(request.user.sub);
    const userIds = await getAccessibleUserIds(prisma, request.user.sub);
    const existing = await prisma.nomenclature.findFirst({ where: { id, userId: { in: userIds } } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    try {
      const updated = await prisma.nomenclature.update({
        where: { id },
        data: toData(parsed.data) as Prisma.NomenclatureUncheckedUpdateInput,
      });
      return updated;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Код уже занят" });
      }
      throw err;
    }
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertCanWriteData(request.user.sub);
    const userIds = await getAccessibleUserIds(prisma, request.user.sub);
    const existing = await prisma.nomenclature.findFirst({ where: { id, userId: { in: userIds } } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    try {
      await prisma.nomenclature.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        return reply.code(409).send({ error: "Conflict", message: "Нельзя удалить: позиция используется в документах" });
      }
      throw err;
    }
  });
}
