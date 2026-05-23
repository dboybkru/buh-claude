// CRUD шаблонов договоров + preview-рендер.
//
// Sprint 9B: read = data:read (VIEWER+), write = print:settings (ADMIN+).
// ContractTemplate доешё без orgId column — read scoping идёт через
// getAccessibleUserIds (compromise), а write через assertHasPermissionInAnyOrg.
// Когда template.organizationId выставлен — проверяем доступ к этой org
// напрямую и сохраняем под org.userId, чтобы template был виден всем members.

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
import {
  assertHasPermissionInAnyOrg,
  getAccessibleUserIds,
  requireOrgAccess,
} from "../lib/org-access.js";

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

  // Whitelist переменных для UI — открыт всем авторизованным
  app.get("/variables", async () => ({ variables: TEMPLATE_VARIABLES }));

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    // Sprint 9B: ContractTemplate is user-scoped (no orgId column). We expose
    // templates owned by every accessible owner so all members of an org see
    // the same template set. See lib/org-access.ts:getAccessibleUserIds.
    const userIds = await getAccessibleUserIds(prisma, request.user.sub);
    const where: Prisma.ContractTemplateWhereInput = {
      userId: { in: userIds },
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
    const userIds = await getAccessibleUserIds(prisma, request.user.sub);
    const tpl = await prisma.contractTemplate.findFirst({
      where: { id, userId: { in: userIds } },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!tpl) throw Errors.notFound("Шаблон договора");
    return tpl;
  });

  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные данные шаблона", parsed.error.flatten());
    const userId = request.user.sub;

    // Templates are organizational settings. ADMIN+ in at least one org, or
    // (when scoped to a specific org) print:settings in that org.
    let ownerUserId = userId;
    if (parsed.data.organizationId) {
      await requireOrgAccess(prisma, userId, parsed.data.organizationId, "print:settings");
      const org = await prisma.organization.findUnique({
        where: { id: parsed.data.organizationId },
        select: { userId: true },
      });
      if (!org) throw Errors.validation("Организация не найдена");
      ownerUserId = org.userId;
    } else {
      await assertHasPermissionInAnyOrg(userId, "print:settings");
    }

    const variables = extractVariables(parsed.data.content);

    const created = await prisma.contractTemplate.create({
      data: {
        userId: ownerUserId,
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
    const userIds = await getAccessibleUserIds(prisma, userId);
    const existing = await prisma.contractTemplate.findFirst({ where: { id, userId: { in: userIds } } });
    if (!existing) throw Errors.notFound("Шаблон договора");

    // Gate the write against the template's current scope (if any) or any-org.
    if (existing.organizationId) {
      await requireOrgAccess(prisma, userId, existing.organizationId, "print:settings");
    } else {
      await assertHasPermissionInAnyOrg(userId, "print:settings");
    }
    // If re-pointing to another org, the caller must also have print:settings there.
    if (parsed.data.organizationId && parsed.data.organizationId !== existing.organizationId) {
      await requireOrgAccess(prisma, userId, parsed.data.organizationId, "print:settings");
      const org = await prisma.organization.findUnique({
        where: { id: parsed.data.organizationId },
        select: { id: true },
      });
      if (!org) throw Errors.validation("Организация не найдена");
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
    const userId = request.user.sub;
    const userIds = await getAccessibleUserIds(prisma, userId);
    const existing = await prisma.contractTemplate.findFirst({ where: { id, userId: { in: userIds } } });
    if (!existing) throw Errors.notFound("Шаблон договора");
    if (existing.organizationId) {
      await requireOrgAccess(prisma, userId, existing.organizationId, "print:settings");
    } else {
      await assertHasPermissionInAnyOrg(userId, "print:settings");
    }
    await prisma.contractTemplate.delete({ where: { id } });
    return { ok: true };
  });

  // POST /render-preview — отрендерить шаблон с подстановкой реквизитов.
  // Чисто read-only: VIEWER+ ок.
  app.post("/render-preview", async (request) => {
    const body = renderPreviewSchema.parse(request.body);
    const userId = request.user.sub;
    const userIds = await getAccessibleUserIds(prisma, userId);

    let content = body.content ?? "";
    if (!content && body.templateId) {
      const tpl = await prisma.contractTemplate.findFirst({
        where: { id: body.templateId, userId: { in: userIds } },
      });
      if (!tpl) throw Errors.notFound("Шаблон договора");
      content = tpl.content;
    }
    if (!content) throw Errors.validation("Нужен templateId или content");

    if (!body.organizationId || !body.counterpartyId) {
      // Возвращаем render с переменными — UI подставит сам
      return renderTemplate(content, {});
    }

    // Caller must at least be able to read the org's data for the preview.
    await requireOrgAccess(prisma, userId, body.organizationId, "data:read");
    const [org, cp] = await Promise.all([
      prisma.organization.findUnique({ where: { id: body.organizationId } }),
      prisma.counterparty.findFirst({
        where: { id: body.counterpartyId, userId: { in: userIds } },
      }),
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
