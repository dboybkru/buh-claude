// CRUD шаблонов договоров + preview-рендер.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/api-error.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";
import {
  TEMPLATE_VARIABLES,
  extractVariables,
  renderContract,
  renderTemplate,
} from "../lib/contract-template.js";

const baseShape = {
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  content: z.string().min(1, "Текст шаблона обязателен"),
  organizationId: z.string().uuid().optional().nullable(),
  isDefault: z.boolean().default(false),
};

const createSchema = z.object(baseShape);
const updateSchema = z.object(baseShape).partial();

const renderPreviewSchema = z.object({
  templateId: z.string().uuid().optional(),
  content: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  counterpartyId: z.string().uuid().optional(),
  contract: z
    .object({
      number: z.string().optional(),
      date: z.string().optional(),
      amount: z.coerce.number().optional(),
      subject: z.string().optional(),
      currency: z.string().optional(),
    })
    .optional(),
});

export async function contractTemplatesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // Whitelist переменных для UI
  app.get("/variables", async () => ({ variables: TEMPLATE_VARIABLES }));

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const where: Prisma.ContractTemplateWhereInput = {
      userId,
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: "insensitive" } },
              { description: { contains: q.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const orderBy = parseSort(q.sort, ["createdAt", "name"], { createdAt: "desc" });
    const [items, total] = await Promise.all([
      prisma.contractTemplate.findMany({
        where,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy,
        include: { organization: { select: { id: true, name: true } } },
      }),
      prisma.contractTemplate.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const tpl = await prisma.contractTemplate.findFirst({
      where: { id, userId: request.user.sub },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!tpl) throw Errors.notFound("Шаблон договора");
    return tpl;
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные данные шаблона", parsed.error.flatten());
    const userId = request.user.sub;

    if (parsed.data.organizationId) {
      const owns = await prisma.organization.findFirst({
        where: { id: parsed.data.organizationId, userId },
        select: { id: true },
      });
      if (!owns) throw Errors.validation("Организация не найдена");
    }

    const variables = extractVariables(parsed.data.content);

    const created = await prisma.contractTemplate.create({
      data: {
        userId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        content: parsed.data.content,
        organizationId: parsed.data.organizationId ?? null,
        isDefault: parsed.data.isDefault,
        variables,
      },
    });
    return reply.code(201).send(created);
  });

  app.patch("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные данные шаблона", parsed.error.flatten());
    const userId = request.user.sub;
    const existing = await prisma.contractTemplate.findFirst({ where: { id, userId } });
    if (!existing) throw Errors.notFound("Шаблон договора");

    if (parsed.data.organizationId) {
      const owns = await prisma.organization.findFirst({
        where: { id: parsed.data.organizationId, userId },
        select: { id: true },
      });
      if (!owns) throw Errors.validation("Организация не найдена");
    }

    const data: Prisma.ContractTemplateUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.description !== undefined) data.description = parsed.data.description;
    if (parsed.data.organizationId !== undefined) {
      data.organization = parsed.data.organizationId
        ? { connect: { id: parsed.data.organizationId } }
        : { disconnect: true };
    }
    if (parsed.data.isDefault !== undefined) data.isDefault = parsed.data.isDefault;
    if (parsed.data.content !== undefined) {
      data.content = parsed.data.content;
      data.variables = extractVariables(parsed.data.content);
    }

    return prisma.contractTemplate.update({ where: { id }, data });
  });

  app.delete("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await prisma.contractTemplate.findFirst({ where: { id, userId: request.user.sub } });
    if (!existing) throw Errors.notFound("Шаблон договора");
    await prisma.contractTemplate.delete({ where: { id } });
    return { ok: true };
  });

  // POST /render-preview — отрендерить шаблон с подстановкой реквизитов
  app.post("/render-preview", async (request) => {
    const body = renderPreviewSchema.parse(request.body);
    const userId = request.user.sub;

    let content = body.content ?? "";
    if (!content && body.templateId) {
      const tpl = await prisma.contractTemplate.findFirst({
        where: { id: body.templateId, userId },
      });
      if (!tpl) throw Errors.notFound("Шаблон договора");
      content = tpl.content;
    }
    if (!content) throw Errors.validation("Нужен templateId или content");

    if (!body.organizationId || !body.counterpartyId) {
      // Возвращаем render с переменными — UI подставит сам
      return renderTemplate(content, {});
    }

    const [org, cp] = await Promise.all([
      prisma.organization.findFirst({ where: { id: body.organizationId, userId } }),
      prisma.counterparty.findFirst({ where: { id: body.counterpartyId, userId } }),
    ]);
    if (!org) throw Errors.validation("Организация не найдена");
    if (!cp) throw Errors.validation("Контрагент не найден");

    return renderContract(content, {
      organization: org,
      counterparty: cp,
      contract: {
        number:   body.contract?.number ?? "<номер>",
        date:     body.contract?.date ?? new Date().toISOString().slice(0, 10),
        amount:   body.contract?.amount,
        currency: body.contract?.currency ?? "RUB",
        subject:  body.contract?.subject ?? "",
      },
    });
  });
}
