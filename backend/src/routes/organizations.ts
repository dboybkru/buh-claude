import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  innSchema,
  kppSchema,
  ogrnSchema,
  paginationSchema,
  parseSort,
  paginate,
} from "../lib/validators.js";
import { Errors } from "../lib/api-error.js";
import { getUserOrgIds, requireOrgAccess } from "../lib/org-access.js";

const orgTypeEnum = z.enum(["OOO", "AO", "PAO", "ZAO", "OAO", "IP"]);
const taxSystemEnum = z.enum(["OSN", "USN", "USN_INCOME", "AUSN", "ENVD", "PSN", "NPD"]);
const vatModeEnum = z.enum(["EXEMPT", "USN_5", "USN_7", "GENERAL"]);

const orgBaseShape = {
  type: orgTypeEnum,
  name: z.string().min(1).max(255),
  fullName: z.string().min(1).max(500),
  inn: innSchema,
  kpp: kppSchema.optional().nullable(),
  ogrn: ogrnSchema.optional().nullable(),
  okpo: z.string().optional().nullable(),
  oktmo: z.string().optional().nullable(),
  okveds: z.array(z.string()).default([]),
  directorName: z.string().optional().nullable(),
  directorPosition: z.string().optional().nullable(),
  entrepreneurName: z.string().optional().nullable(),
  chiefAccountant: z.string().optional().nullable(),
  accountantPosition: z.string().optional().nullable(),
  basedOn: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal("").transform(() => null)),
  phone: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  legalAddress: z.string().min(1).max(500),
  actualAddress: z.string().optional().nullable(),
  postalAddress: z.string().optional().nullable(),
  logo: z.string().optional().nullable(),
  stamp: z.string().optional().nullable(),
  signature: z.string().optional().nullable(),
  vatMode: vatModeEnum.default("GENERAL"),
  taxSystem: taxSystemEnum.default("OSN"),
  isDefault: z.boolean().default(false),
  printShowLogo: z.boolean().optional(),
  printShowStamp: z.boolean().optional(),
  printShowSignature: z.boolean().optional(),
  printShowAccountantSignature: z.boolean().optional(),
  printShowBankDetails: z.boolean().optional(),
  printShowQrCode: z.boolean().optional(),
  printDefaultVatText: z.string().optional().nullable(),
  printDefaultPaymentTerms: z.string().optional().nullable(),
  printDefaultFooterText: z.string().optional().nullable(),
  printInvoiceNote: z.string().optional().nullable(),
  printActNote: z.string().optional().nullable(),
  printUpdNote: z.string().optional().nullable(),
  printWaybillNote: z.string().optional().nullable(),
  printReconciliationNote: z.string().optional().nullable(),
};

const createSchema = z.object(orgBaseShape).superRefine((data, ctx) => {
  if (data.type !== "IP" && !data.kpp) {
    ctx.addIssue({ code: "custom", path: ["kpp"], message: "КПП обязателен для юрлица" });
  }
  if (data.type === "IP" && data.kpp) {
    ctx.addIssue({ code: "custom", path: ["kpp"], message: "У ИП не должно быть КПП" });
  }
  if (data.type === "IP" && data.inn.length !== 12) {
    ctx.addIssue({ code: "custom", path: ["inn"], message: "ИНН ИП должен содержать 12 цифр" });
  }
  if (data.type !== "IP" && data.inn.length !== 10) {
    ctx.addIssue({ code: "custom", path: ["inn"], message: "ИНН юрлица должен содержать 10 цифр" });
  }
});

const updateSchema = z.object(orgBaseShape).partial();

export async function organizationsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // List: every organization the caller is an ACTIVE member of.
  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const orgIds = await getUserOrgIds(prisma, userId);
    const where: Prisma.OrganizationWhereInput = {
      id: { in: orgIds },
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
      prisma.organization.findMany({
        where,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy,
        include: { bankAccounts: true },
      }),
      prisma.organization.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await requireOrgAccess(prisma, request.user.sub, id, "org:read");
    const org = await prisma.organization.findUnique({
      where: { id },
      include: { bankAccounts: true },
    });
    if (!org) throw Errors.notFound("Организация");
    return org;
  });

  // Create: the caller becomes OWNER of the new organization in one tx.
  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    }
    const userId = request.user.sub;
    const data = parsed.data;

    try {
      const created = await prisma.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.organization.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
        }
        const org = await tx.organization.create({ data: { ...data, userId } });
        await tx.organizationMember.create({
          data: {
            organizationId: org.id,
            userId,
            role: "OWNER",
            status: "ACTIVE",
          },
        });
        // If there's a pending INVITED row by email for this user, accept it
        // is not relevant here (we just created a new org).
        return org;
      });
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Организация с таким ИНН уже существует" });
      }
      throw err;
    }
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    }
    // OWNER/ADMIN can edit org core fields; print-* fields are part of update
    // payload but only admin+ can change them — same gate.
    await requireOrgAccess(prisma, request.user.sub, id, "print:settings");

    try {
      const updated = await prisma.$transaction(async (tx) => {
        if (parsed.data.isDefault) {
          // Toggle isDefault flag scoped to the OWNER's other organizations.
          const org = await tx.organization.findUnique({ where: { id }, select: { userId: true } });
          if (org) {
            await tx.organization.updateMany({
              where: { userId: org.userId, isDefault: true, NOT: { id } },
              data: { isDefault: false },
            });
          }
        }
        return tx.organization.update({ where: { id }, data: parsed.data });
      });
      return updated;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "ИНН уже занят другой вашей организацией" });
      }
      throw err;
    }
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await requireOrgAccess(prisma, request.user.sub, id, "org:delete");
    try {
      await prisma.organization.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        return reply
          .code(409)
          .send({ error: "Conflict", message: "Нельзя удалить: есть связанные документы или договоры" });
      }
      throw err;
    }
  });
}
