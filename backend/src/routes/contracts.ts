import type { FastifyInstance } from "fastify";
import { z } from "zod";
import React from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";
import { renderContract } from "../lib/contract-template.js";
import { previewContract } from "../lib/html-preview.js";
import { computePrintWarnings } from "../lib/print-warnings.js";
import { renderPdfStream } from "../pdf/render.js";
import { ContractPdf } from "../pdf/templates/ContractPdf.js";
import { mapSeller, mapBuyer } from "../pdf/map.js";
import { buildPdfContext } from "../pdf/context.js";
import { contentDispositionPdf } from "../pdf/filename.js";
import { getAccessibleUserIds, getUserOrgIds, requireOrgAccess } from "../lib/org-access.js";

const statusEnum = z.enum(["DRAFT", "ACTIVE", "EXPIRED", "TERMINATED"]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате ГГГГ-ММ-ДД");

const baseShape = {
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  templateId: z.string().uuid().optional().nullable(),
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

export async function contractsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const where: Prisma.ContractWhereInput = {
      organizationId: { in: orgIds },
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
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const c = await prisma.contract.findFirst({
      where: { id, organizationId: { in: orgIds } },
      include: { organization: true, counterparty: true },
    });
    if (!c) return reply.code(404).send({ error: "NotFound" });
    return c;
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const userId = request.user.sub;
    const data = parsed.data;

    await requireOrgAccess(prisma, userId, data.organizationId, "data:write");
    const accessibleUserIds = await getAccessibleUserIds(prisma, userId);
    const [org, cp] = await Promise.all([
      prisma.organization.findUnique({ where: { id: data.organizationId } }),
      prisma.counterparty.findFirst({
        where: { id: data.counterpartyId, userId: { in: accessibleUserIds } },
      }),
    ]);
    if (!org) return reply.code(400).send({ error: "ValidationError", message: "Организация не найдена" });
    if (!cp) return reply.code(400).send({ error: "ValidationError", message: "Контрагент не найден" });
    const ownerUserId = org.userId;

    if (data.templateId) {
      const tpl = await prisma.contractTemplate.findFirst({
        where: { id: data.templateId, userId: { in: accessibleUserIds } },
        select: { id: true },
      });
      if (!tpl) return reply.code(400).send({ error: "ValidationError", message: "Шаблон договора не найден" });
    }

    try {
      const created = await prisma.contract.create({
        data: { ...transformDates(data), userId: ownerUserId } as Prisma.ContractUncheckedCreateInput,
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
    const existing = await prisma.contract.findFirst({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    await requireOrgAccess(prisma, userId, existing.organizationId, "data:write");

    if (parsed.data.organizationId || parsed.data.counterpartyId || parsed.data.templateId) {
      const accessibleUserIds = await getAccessibleUserIds(prisma, userId);
      if (parsed.data.organizationId) {
        await requireOrgAccess(prisma, userId, parsed.data.organizationId, "data:write");
      }
      if (parsed.data.counterpartyId) {
        const cp = await prisma.counterparty.findFirst({
          where: { id: parsed.data.counterpartyId, userId: { in: accessibleUserIds } },
          select: { id: true },
        });
        if (!cp) return reply.code(400).send({ error: "ValidationError", message: "Контрагент не найден" });
      }
      if (parsed.data.templateId) {
        const tpl = await prisma.contractTemplate.findFirst({
          where: { id: parsed.data.templateId, userId: { in: accessibleUserIds } },
          select: { id: true },
        });
        if (!tpl) return reply.code(400).send({ error: "ValidationError", message: "Шаблон договора не найден" });
      }
    }

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
    const existing = await prisma.contract.findFirst({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    await requireOrgAccess(prisma, request.user.sub, existing.organizationId, "data:write");
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

  // PDF договора. Если есть templateId — рендерится по шаблону, иначе — body из description.
  app.get("/:id/pdf", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const userId = request.user.sub;
    const orgIds = await getUserOrgIds(prisma, userId);
    const c = await prisma.contract.findFirst({
      where: { id, organizationId: { in: orgIds } },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
        template: true,
      },
    });
    if (!c) return reply.code(404).send({ error: "NotFound" });

    const body = c.template
      ? renderContract(c.template.content, {
          organization: c.organization,
          counterparty: c.counterparty,
          contract: { number: c.number, date: c.date, amount: c.amount, currency: c.currency, subject: c.subject },
        }).text
      : c.description ?? "Текст договора не задан. Создайте шаблон или укажите описание.";

    const ctx = buildPdfContext(c.organization, userId);
    const stream = await renderPdfStream(
      React.createElement(ContractPdf, {
        number: c.number,
        date: c.date,
        seller: mapSeller(c.organization),
        buyer: mapBuyer(c.counterparty),
        body,
        flags: ctx.flags,
        assets: ctx.assets,
        defaultFooterText: ctx.defaultFooterText,
      }),
    );
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", contentDispositionPdf(`Договор ${c.number}`));
    return reply.send(stream);
  });

  app.get("/:id/preview", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const c = await prisma.contract.findFirst({
      where: { id, organizationId: { in: orgIds } },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
        template: true,
      },
    });
    if (!c) return reply.code(404).send({ error: "NotFound" });
    const body = c.template
      ? renderContract(c.template.content, {
          organization: c.organization,
          counterparty: c.counterparty,
          contract: { number: c.number, date: c.date, amount: c.amount, currency: c.currency, subject: c.subject },
        }).text
      : c.description ?? "Текст договора не задан. Создайте шаблон или укажите описание.";
    const html = previewContract({
      number: c.number,
      date: c.date,
      amount: c.amount,
      organization: c.organization as any,
      counterparty: c.counterparty as any,
      body,
    });
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });

  app.get("/:id/print-warnings", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const c = await prisma.contract.findFirst({
      where: { id, organizationId: { in: orgIds } },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
      },
    });
    if (!c) return reply.code(404).send({ error: "NotFound" });
    return { warnings: computePrintWarnings({ kind: "contract", organization: c.organization, counterparty: c.counterparty, subject: c.subject }) };
  });
}
