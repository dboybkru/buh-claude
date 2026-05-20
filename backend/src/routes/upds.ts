import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";
import { nextDocumentNumber } from "../lib/numbering.js";
import { itemInputSchema, prepareItems, itemCreateData } from "../lib/document-items.js";
import { isDocStatusLocked } from "../lib/document-status.js";
import { renderPdfStream } from "../pdf/render.js";
import { UpdPdf } from "../pdf/templates/UpdPdf.js";
import { mapSeller, mapBuyer, mapItems } from "../pdf/map.js";
import { contentDispositionPdf } from "../pdf/filename.js";
import React from "react";

const statusEnum = z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "SIGNED", "PAID", "CANCELLED"]);
const functionEnum = z.enum(["FULL", "TRANSFER_ONLY"]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const baseFields = {
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  contractId: z.string().uuid().optional().nullable(),
  invoiceId: z.string().uuid().optional().nullable(),
  date: dateString,
  functionType: functionEnum.default("FULL"),
  currency: z.string().length(3).default("RUB"),
  status: statusEnum.optional(),
  vatRate: z.coerce.number().min(0).max(99.99).default(20),
  vatIncluded: z.boolean().default(false), // в счёте-фактуре НДС обычно сверху
  shipmentDate: dateString.optional().nullable(),
  shipmentAddress: z.string().optional().nullable(),
  customsDecl: z.string().optional().nullable(),
  paymentDocRef: z.string().optional().nullable(),
  sellerSignatory: z.string().optional().nullable(),
  buyerSignatory: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
};

const createSchema = z.object({ ...baseFields, number: z.string().optional(), items: z.array(itemInputSchema).min(1) });
const updateSchema = z.object({ ...baseFields, number: z.string().optional(), items: z.array(itemInputSchema).min(1).optional() }).partial();

function toDate(s: string | null | undefined): Date | null | undefined {
  if (s == null) return s;
  return new Date(s);
}

export async function updsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (request) => {
    const q = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const where: Prisma.UpdDocumentWhereInput = {
      userId,
      ...(q.q ? { OR: [
        { number: { contains: q.q, mode: "insensitive" } },
        { counterparty: { name: { contains: q.q, mode: "insensitive" } } },
      ] } : {}),
    };
    const orderBy = parseSort(q.sort, ["createdAt", "date", "number", "total"], { date: "desc" });
    const [items, total] = await Promise.all([
      prisma.updDocument.findMany({
        where, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy,
        include: {
          organization: { select: { id: true, name: true } },
          counterparty: { select: { id: true, name: true, inn: true } },
        },
      }),
      prisma.updDocument.count({ where }),
    ]);
    return paginate(items, total, q.page, q.pageSize);
  });

  app.get("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const upd = await prisma.updDocument.findFirst({
      where: { id, userId: request.user.sub },
      include: { organization: true, counterparty: true, contract: true, invoice: true, items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!upd) return reply.code(404).send({ error: "NotFound" });
    return upd;
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
        const number = data.number ?? (await nextDocumentNumber(tx, userId, data.organizationId, "UPD", year));
        const upd = await tx.updDocument.create({
          data: {
            userId,
            organizationId: data.organizationId,
            counterpartyId: data.counterpartyId,
            contractId: data.contractId ?? null,
            invoiceId: data.invoiceId ?? null,
            number,
            date: new Date(data.date),
            functionType: data.functionType,
            currency: data.currency,
            status: data.status ?? "DRAFT",
            vatRate: data.vatRate,
            vatIncluded: data.vatIncluded,
            subtotal: Number(totals.subtotal),
            vatAmount: Number(totals.vatAmount),
            total: Number(totals.total),
            shipmentDate: toDate(data.shipmentDate),
            shipmentAddress: data.shipmentAddress ?? null,
            customsDecl: data.customsDecl ?? null,
            paymentDocRef: data.paymentDocRef ?? null,
            sellerSignatory: data.sellerSignatory ?? null,
            buyerSignatory: data.buyerSignatory ?? null,
            notes: data.notes ?? null,
            fileUrl: data.fileUrl ?? null,
          },
        });
        await tx.documentItem.createMany({
          data: prepared.map((it) => itemCreateData(it, userId, "UPD", upd.id)),
        });
        return upd;
      });
      const full = await prisma.updDocument.findUnique({ where: { id: created.id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
      return reply.code(201).send(full);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "УПД с таким номером уже существует" });
      }
      throw err;
    }
  });

  app.patch("/:id", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    const userId = request.user.sub;
    const existing = await prisma.updDocument.findFirst({ where: { id, userId } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    if (isDocStatusLocked(existing.status)) {
      return reply.code(409).send({ error: "Locked", message: `УПД в статусе ${existing.status} нельзя редактировать` });
    }
    const data = parsed.data;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const vatIncluded = data.vatIncluded ?? existing.vatIncluded;
        let totalsPatch: { subtotal: number; vatAmount: number; total: number } | null = null;
        if (data.items) {
          const { prepared, totals } = prepareItems(data.items, vatIncluded);
          await tx.documentItem.deleteMany({ where: { updId: id } });
          await tx.documentItem.createMany({ data: prepared.map((it) => itemCreateData(it, userId, "UPD", id)) });
          totalsPatch = { subtotal: Number(totals.subtotal), vatAmount: Number(totals.vatAmount), total: Number(totals.total) };
        }
        return tx.updDocument.update({
          where: { id },
          data: {
            ...(data.organizationId !== undefined ? { organizationId: data.organizationId } : {}),
            ...(data.counterpartyId !== undefined ? { counterpartyId: data.counterpartyId } : {}),
            ...(data.contractId !== undefined ? { contractId: data.contractId } : {}),
            ...(data.invoiceId !== undefined ? { invoiceId: data.invoiceId } : {}),
            ...(data.number !== undefined ? { number: data.number } : {}),
            ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
            ...(data.functionType !== undefined ? { functionType: data.functionType } : {}),
            ...(data.currency !== undefined ? { currency: data.currency } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.vatRate !== undefined ? { vatRate: data.vatRate } : {}),
            ...(data.vatIncluded !== undefined ? { vatIncluded: data.vatIncluded } : {}),
            ...(data.shipmentDate !== undefined ? { shipmentDate: data.shipmentDate ? new Date(data.shipmentDate) : null } : {}),
            ...(data.shipmentAddress !== undefined ? { shipmentAddress: data.shipmentAddress } : {}),
            ...(data.customsDecl !== undefined ? { customsDecl: data.customsDecl } : {}),
            ...(data.paymentDocRef !== undefined ? { paymentDocRef: data.paymentDocRef } : {}),
            ...(data.sellerSignatory !== undefined ? { sellerSignatory: data.sellerSignatory } : {}),
            ...(data.buyerSignatory !== undefined ? { buyerSignatory: data.buyerSignatory } : {}),
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
    const existing = await prisma.updDocument.findFirst({ where: { id, userId: request.user.sub } });
    if (!existing) return reply.code(404).send({ error: "NotFound" });
    if (isDocStatusLocked(existing.status)) {
      return reply.code(409).send({ error: "Locked", message: `УПД в статусе ${existing.status} нельзя удалить` });
    }
    await prisma.updDocument.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/:id/pdf", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const upd = await prisma.updDocument.findFirst({
      where: { id, userId: request.user.sub },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
        items: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!upd) return reply.code(404).send({ error: "NotFound" });

    const stream = await renderPdfStream(
      React.createElement(UpdPdf, {
        number: upd.number,
        date: upd.date,
        functionType: upd.functionType,
        subtotal: upd.subtotal,
        vatAmount: upd.vatAmount,
        total: upd.total,
        seller: mapSeller(upd.organization),
        buyer: mapBuyer(upd.counterparty),
        items: mapItems(upd.items),
        shipmentDate: upd.shipmentDate,
        shipmentAddress: upd.shipmentAddress,
        customsDecl: upd.customsDecl,
        paymentDocRef: upd.paymentDocRef,
        sellerSignatory: upd.sellerSignatory,
        buyerSignatory: upd.buyerSignatory,
        notes: upd.notes,
      }),
    );
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", contentDispositionPdf(`УПД ${upd.number}`));
    return reply.send(stream);
  });
}
