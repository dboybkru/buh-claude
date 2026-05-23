import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";
import { nextDocumentNumber } from "../lib/numbering.js";
import { itemInputSchema, prepareItems, itemCreateData } from "../lib/document-items.js";
import { isDocStatusLocked } from "../lib/document-status.js";
import { renderPdfStream } from "../pdf/render.js";
import { WaybillPdf } from "../pdf/templates/WaybillPdf.js";
import { mapSeller, mapBuyer, mapItems } from "../pdf/map.js";
import { buildPdfContext } from "../pdf/context.js";
import { contentDispositionPdf } from "../pdf/filename.js";
import { previewWaybill } from "../lib/html-preview.js";
import { computePrintWarnings } from "../lib/print-warnings.js";
import { getAccessibleUserIds, getUserOrgIds, requireOrgAccess } from "../lib/org-access.js";
import React from "react";

const statusEnum = z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "SIGNED", "PAID", "CANCELLED"]);
const opEnum = z.enum(["SALE", "PURCHASE", "RETURN", "TRANSFER"]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseFields = {
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  contractId: z.string().uuid().optional().nullable(),
  invoiceId: z.string().uuid().optional().nullable(),
  date: dateString,
  operationType: opEnum.default("SALE"),
  currency: z.string().length(3).default("RUB"),
  status: statusEnum.optional(),
  vatRate: z.coerce.number().min(0).max(99.99).default(20),
  vatIncluded: z.boolean().default(true),
  shippedBy: z.string().optional().nullable(),
  receivedBy: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
};

const createSchema = z.object({ ...baseFields, number: z.string().optional(), items: z.array(itemInputSchema).min(1) });
const updateSchema = z.object({ ...baseFields, number: z.string().optional(), items: z.array(itemInputSchema).min(1).optional() }).partial();

export async function waybillsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const status = (request.query as { status?: string }).status;
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const where: Prisma.WaybillWhereInput = {
      organizationId: { in: orgIds },
      ...(status && status !== "all" ? { status: status as Prisma.WaybillWhereInput["status"] } : {}),
      ...(q.q ? { OR: [
        { number: { contains: q.q, mode: "insensitive" } },
        { counterparty: { name: { contains: q.q, mode: "insensitive" } } },
      ] } : {}),
    };
    const orderBy = parseSort(q.sort, ["createdAt", "date", "number", "total"], { date: "desc" });
    const [items, total] = await Promise.all([
      prisma.waybill.findMany({
        where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy,
        include: {
          organization: { select: { id: true, name: true } },
          counterparty: { select: { id: true, name: true, inn: true } },
        },
      }),
      prisma.waybill.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const wb = await prisma.waybill.findFirst({
      where: { id, organizationId: { in: orgIds } },
      include: { organization: true, counterparty: true, contract: true, invoice: true, items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!wb) return reply.code(404).send({ error: "NotFound" });
    return wb;
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

    const { prepared, totals } = prepareItems(data.items, data.vatIncluded);
    const year = new Date(data.date).getFullYear();

    try {
      const created = await prisma.$transaction(async (tx) => {
        const number = data.number ?? (await nextDocumentNumber(tx, ownerUserId, data.organizationId, "WAYBILL", year));
        const wb = await tx.waybill.create({
          data: {
            userId: ownerUserId,
            organizationId: data.organizationId,
            counterpartyId: data.counterpartyId,
            contractId: data.contractId ?? null,
            invoiceId: data.invoiceId ?? null,
            number,
            date: new Date(data.date),
            operationType: data.operationType,
            currency: data.currency,
            status: data.status ?? "DRAFT",
            vatRate: data.vatRate,
            vatIncluded: data.vatIncluded,
            subtotal: Number(totals.subtotal),
            vatAmount: Number(totals.vatAmount),
            total: Number(totals.total),
            shippedBy: data.shippedBy ?? null,
            receivedBy: data.receivedBy ?? null,
            notes: data.notes ?? null,
            fileUrl: data.fileUrl ?? null,
          },
        });
        await tx.documentItem.createMany({
          data: prepared.map((it) => itemCreateData(it, ownerUserId, "WAYBILL", wb.id)),
        });
        return wb;
      });
      const full = await prisma.waybill.findUnique({ where: { id: created.id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
      return reply.code(201).send(full);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "ТОРГ-12 с таким номером уже существует" });
      }
      throw err;
    }
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const userId = request.user.sub;
    const existing = await prisma.waybill.findFirst({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    await requireOrgAccess(prisma, userId, existing.organizationId, "data:write");
    if (isDocStatusLocked(existing.status)) {
      return reply.code(409).send({ error: "Locked", message: `Накладная в статусе ${existing.status} нельзя редактировать` });
    }
    const data = parsed.data;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const vatIncluded = data.vatIncluded ?? existing.vatIncluded;
        let totalsPatch: { subtotal: number; vatAmount: number; total: number } | null = null;
        if (data.items) {
          const { prepared, totals } = prepareItems(data.items, vatIncluded);
          await tx.documentItem.deleteMany({ where: { waybillId: id } });
          await tx.documentItem.createMany({ data: prepared.map((it) => itemCreateData(it, existing.userId, "WAYBILL", id)) });
          totalsPatch = { subtotal: Number(totals.subtotal), vatAmount: Number(totals.vatAmount), total: Number(totals.total) };
        }
        return tx.waybill.update({
          where: { id },
          data: {
            ...(data.organizationId !== undefined ? { organizationId: data.organizationId } : {}),
            ...(data.counterpartyId !== undefined ? { counterpartyId: data.counterpartyId } : {}),
            ...(data.contractId !== undefined ? { contractId: data.contractId } : {}),
            ...(data.invoiceId !== undefined ? { invoiceId: data.invoiceId } : {}),
            ...(data.number !== undefined ? { number: data.number } : {}),
            ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
            ...(data.operationType !== undefined ? { operationType: data.operationType } : {}),
            ...(data.currency !== undefined ? { currency: data.currency } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.vatRate !== undefined ? { vatRate: data.vatRate } : {}),
            ...(data.vatIncluded !== undefined ? { vatIncluded: data.vatIncluded } : {}),
            ...(data.shippedBy !== undefined ? { shippedBy: data.shippedBy } : {}),
            ...(data.receivedBy !== undefined ? { receivedBy: data.receivedBy } : {}),
            ...(data.notes !== undefined ? { notes: data.notes } : {}),
            ...(data.fileUrl !== undefined ? { fileUrl: data.fileUrl } : {}),
            ...(totalsPatch ?? {}),
          },
          include: { items: { orderBy: { sortOrder: "asc" } } },
        });
      });
      return updated;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Номер занят" });
      }
      throw err;
    }
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await prisma.waybill.findFirst({ where: { id } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    await requireOrgAccess(prisma, request.user.sub, existing.organizationId, "data:write");
    if (isDocStatusLocked(existing.status)) {
      return reply.code(409).send({ error: "Locked", message: `Накладная в статусе ${existing.status} нельзя удалить` });
    }
    await prisma.waybill.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/:id/pdf", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const wb = await prisma.waybill.findFirst({
      where: { id, organizationId: { in: orgIds } },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
        items: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!wb) return reply.code(404).send({ error: "NotFound" });

    const ctx = buildPdfContext(wb.organization, request.user.sub);
    const stream = await renderPdfStream(
      React.createElement(WaybillPdf, {
        number: wb.number,
        date: wb.date,
        operationType: wb.operationType,
        subtotal: wb.subtotal,
        vatAmount: wb.vatAmount,
        total: wb.total,
        seller: mapSeller(wb.organization),
        buyer: mapBuyer(wb.counterparty),
        items: mapItems(wb.items),
        shippedBy: wb.shippedBy,
        receivedBy: wb.receivedBy,
        notes: wb.notes,
        flags: ctx.flags,
        assets: ctx.assets,
        vatLabel: ctx.vatLabel,
        defaultFooterText: ctx.defaultFooterText,
        waybillNote: ctx.waybillNote,
      }),
    );
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", contentDispositionPdf(`ТОРГ-12 ${wb.number}`));
    return reply.send(stream);
  });

  app.get("/:id/preview", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const wb = await prisma.waybill.findFirst({
      where: { id, organizationId: { in: orgIds } },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
        items: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!wb) return reply.code(404).send({ error: "NotFound" });
    const html = previewWaybill({
      number: wb.number,
      date: wb.date,
      operationType: wb.operationType,
      subtotal: wb.subtotal,
      vatAmount: wb.vatAmount,
      total: wb.total,
      organization: wb.organization as any,
      counterparty: wb.counterparty as any,
      items: wb.items as any,
      shippedBy: wb.shippedBy,
      receivedBy: wb.receivedBy,
    });
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });

  app.get("/:id/print-warnings", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const orgIds = await getUserOrgIds(prisma, request.user.sub);
    const wb = await prisma.waybill.findFirst({
      where: { id, organizationId: { in: orgIds } },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
        items: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!wb) return reply.code(404).send({ error: "NotFound" });
    return { warnings: computePrintWarnings({ kind: "waybill", organization: wb.organization, counterparty: wb.counterparty, items: wb.items }) };
  });
}
