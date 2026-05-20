import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { bikSchema, accountSchema } from "../lib/validators.js";

const baseShape = {
  bankName: z.string().min(1).max(255),
  bik: bikSchema,
  account: accountSchema,
  corrAccount: accountSchema,
  isDefault: z.boolean().default(false),
};
const createSchema = z.object(baseShape);
const updateSchema = z.object(baseShape).partial();

async function userOwnsOrg(userId: string, organizationId: string) {
  const o = await prisma.organization.findFirst({ where: { id: organizationId, userId } });
  return !!o;
}

// Все роуты под /api/v1/organizations/:organizationId/bank-accounts
export async function bankAccountsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  const paramsSchema = z.object({ organizationId: z.string().uuid() });
  const fullParamsSchema = paramsSchema.extend({ id: z.string().uuid() });

  app.get("/", async (request, reply) => {
    const { organizationId } = paramsSchema.parse(request.params);
    if (!(await userOwnsOrg(request.user.sub, organizationId))) {
      return reply.code(404).send({ error: "NotFound" });
    }
    const items = await prisma.bankAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
    return { items };
  });

  app.post("/", async (request, reply) => {
    const { organizationId } = paramsSchema.parse(request.params);
    if (!(await userOwnsOrg(request.user.sub, organizationId))) {
      return reply.code(404).send({ error: "NotFound" });
    }
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const created = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.bankAccount.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.bankAccount.create({ data: { ...parsed.data, organizationId } });
    });
    return reply.code(201).send(created);
  });

  app.patch("/:id", async (request, reply) => {
    const { organizationId, id } = fullParamsSchema.parse(request.params);
    if (!(await userOwnsOrg(request.user.sub, organizationId))) {
      return reply.code(404).send({ error: "NotFound" });
    }
    const existing = await prisma.bankAccount.findFirst({ where: { id, organizationId } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const updated = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.bankAccount.updateMany({
          where: { organizationId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.bankAccount.update({ where: { id }, data: parsed.data as Prisma.BankAccountUncheckedUpdateInput });
    });
    return updated;
  });

  app.delete("/:id", async (request, reply) => {
    const { organizationId, id } = fullParamsSchema.parse(request.params);
    if (!(await userOwnsOrg(request.user.sub, organizationId))) {
      return reply.code(404).send({ error: "NotFound" });
    }
    const existing = await prisma.bankAccount.findFirst({ where: { id, organizationId } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    try {
      await prisma.bankAccount.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        return reply.code(409).send({ error: "Conflict", message: "Нельзя удалить: счёт используется в документах" });
      }
      throw err;
    }
  });
}
