import type { FastifyInstance } from "fastify";
import { z } from "zod";
import React from "react";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { paginationSchema, parseSort, paginate } from "../lib/validators.js";
import { Errors } from "../lib/api-error.js";
import { computeReconciliation } from "../lib/reconciliation.js";
import { renderPdfStream } from "../pdf/render.js";
import { ReconciliationPdf } from "../pdf/templates/ReconciliationPdf.js";
import { mapSeller, mapBuyer } from "../pdf/map.js";
import { buildPdfContext } from "../pdf/context.js";
import { contentDisposition } from "../lib/http.js";
import { previewReconciliation } from "../lib/html-preview.js";
import { computePrintWarnings } from "../lib/print-warnings.js";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата ГГГГ-ММ-ДД");

const previewSchema = z.object({
  organizationId: z.string().uuid(),
  counterpartyId: z.string().uuid(),
  periodFrom: dateStr,
  periodTo: dateStr,
});

const createSchema = previewSchema.extend({
  number: z.string().min(1).optional(),
  date: dateStr.optional(),
  notes: z.string().optional().nullable(),
});

const updateSchema = z.object({
  number: z.string().min(1).optional(),
  date: dateStr.optional(),
  status: z.enum(["DRAFT", "SENT", "AGREED", "DISAGREED"]).optional(),
  notes: z.string().optional().nullable(),
});

function nextNumber(year: number, lastNumber: number): string {
  return `АС-${String(lastNumber + 1).padStart(3, "0")}/${year}`;
}

export async function reconciliationsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // Превью: расчёт на лету без сохранения
  app.get("/preview", async (request) => {
    const q = previewSchema.parse(request.query);
    const userId = request.user.sub;

    const [org, cp] = await Promise.all([
      prisma.organization.findFirst({ where: { id: q.organizationId, userId } }),
      prisma.counterparty.findFirst({ where: { id: q.counterpartyId, userId } }),
    ]);
    if (!org) throw Errors.validation("Организация не найдена");
    if (!cp) throw Errors.validation("Контрагент не найден");

    const from = new Date(q.periodFrom);
    const to = new Date(q.periodTo);
    if (from > to) throw Errors.validation("Период некорректен: дата начала позже даты окончания");

    const result = await computeReconciliation(userId, q.organizationId, q.counterpartyId, from, to);
    return { ...result, organization: { id: org.id, name: org.name, inn: org.inn }, counterparty: { id: cp.id, name: cp.name, inn: cp.inn } };
  });

  // Список сохранённых актов
  app.get("/", async (request) => {
    const p = paginationSchema.parse(request.query);
    const userId = request.user.sub;
    const where: Prisma.ReconciliationActWhereInput = {
      userId,
      ...(p.q ? {
        OR: [
          { number: { contains: p.q, mode: "insensitive" } },
          { counterparty: { name: { contains: p.q, mode: "insensitive" } } },
        ],
      } : {}),
    };
    const orderBy = parseSort(p.sort, ["createdAt", "date", "periodTo", "number"], { date: "desc" });
    const [items, total] = await Promise.all([
      prisma.reconciliationAct.findMany({
        where,
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
        orderBy,
        include: {
          organization: { select: { id: true, name: true } },
          counterparty: { select: { id: true, name: true, inn: true } },
        },
      }),
      prisma.reconciliationAct.count({ where }),
    ]);
    return paginate(items, total, p.page, p.pageSize);
  });

  // Один акт
  app.get("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const rec = await prisma.reconciliationAct.findFirst({
      where: { id, userId: request.user.sub },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
      },
    });
    if (!rec) throw Errors.notFound("Акт сверки");
    return rec;
  });

  // Создание (сохранение снимка)
  app.post("/", async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные поля акта сверки", parsed.error.flatten());
    const userId = request.user.sub;
    const data = parsed.data;

    const [org, cp] = await Promise.all([
      prisma.organization.findFirst({ where: { id: data.organizationId, userId } }),
      prisma.counterparty.findFirst({ where: { id: data.counterpartyId, userId } }),
    ]);
    if (!org) throw Errors.validation("Организация не найдена");
    if (!cp) throw Errors.validation("Контрагент не найден");

    const from = new Date(data.periodFrom);
    const to = new Date(data.periodTo);
    if (from > to) throw Errors.validation("Период некорректен");

    const result = await computeReconciliation(userId, data.organizationId, data.counterpartyId, from, to);
    const year = to.getFullYear();
    const last = await prisma.reconciliationAct.count({ where: { userId, organizationId: data.organizationId } });
    const number = data.number ?? nextNumber(year, last);

    try {
      const created = await prisma.reconciliationAct.create({
        data: {
          userId,
          organizationId: data.organizationId,
          counterpartyId: data.counterpartyId,
          number,
          date: data.date ? new Date(data.date) : new Date(),
          periodFrom: from,
          periodTo: to,
          openingBalance: result.openingBalance,
          totalDebit: result.totalDebit,
          totalCredit: result.totalCredit,
          closingBalance: result.closingBalance,
          lines: result.lines as unknown as Prisma.InputJsonValue,
          notes: data.notes ?? null,
        },
      });
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw Errors.conflict("Акт сверки с таким номером уже существует");
      }
      throw err;
    }
  });

  app.patch("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw Errors.validation("Невалидные поля", parsed.error.flatten());
    const existing = await prisma.reconciliationAct.findFirst({ where: { id, userId: request.user.sub } });
    if (!existing) throw Errors.notFound("Акт сверки");
    const data = parsed.data;
    try {
      return await prisma.reconciliationAct.update({
        where: { id },
        data: {
          ...(data.number !== undefined ? { number: data.number } : {}),
          ...(data.date !== undefined ? { date: new Date(data.date) } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw Errors.conflict("Номер занят");
      }
      throw err;
    }
  });

  app.delete("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const existing = await prisma.reconciliationAct.findFirst({ where: { id, userId: request.user.sub } });
    if (!existing) throw Errors.notFound("Акт сверки");
    await prisma.reconciliationAct.delete({ where: { id } });
    return { ok: true };
  });

  // PDF — берётся из сохранённого снимка
  app.get("/:id/pdf", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const rec = await prisma.reconciliationAct.findFirst({
      where: { id, userId: request.user.sub },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
      },
    });
    if (!rec) throw Errors.notFound("Акт сверки");

    const ctx = buildPdfContext(rec.organization, request.user.sub);
    const stream = await renderPdfStream(
      React.createElement(ReconciliationPdf, {
        number: rec.number,
        date: rec.date,
        periodFrom: rec.periodFrom,
        periodTo: rec.periodTo,
        seller: mapSeller(rec.organization),
        buyer: mapBuyer(rec.counterparty),
        openingBalance: Number(rec.openingBalance),
        totalDebit: Number(rec.totalDebit),
        totalCredit: Number(rec.totalCredit),
        closingBalance: Number(rec.closingBalance),
        lines: rec.lines as unknown as Array<{ date: string; description: string; debit: number; credit: number }>,
        notes: rec.notes,
        flags: ctx.flags,
        assets: ctx.assets,
        defaultFooterText: ctx.defaultFooterText,
        reconciliationNote: ctx.reconciliationNote,
      }),
    );
    reply.header("Content-Type", "application/pdf");
    reply.header("Content-Disposition", contentDisposition(`Акт сверки ${rec.number}`, "pdf"));
    return reply.send(stream);
  });

  app.get("/:id/preview", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const rec = await prisma.reconciliationAct.findFirst({
      where: { id, userId: request.user.sub },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
      },
    });
    if (!rec) throw Errors.notFound("Акт сверки");
    const html = previewReconciliation({
      number: rec.number,
      date: rec.date,
      periodFrom: rec.periodFrom,
      periodTo: rec.periodTo,
      organization: rec.organization as any,
      counterparty: rec.counterparty as any,
      openingBalance: Number(rec.openingBalance),
      totalDebit: Number(rec.totalDebit),
      totalCredit: Number(rec.totalCredit),
      closingBalance: Number(rec.closingBalance),
      lines: rec.lines as unknown as Array<{ date: string; description: string; debit: number; credit: number }>,
    });
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });

  app.get("/:id/print-warnings", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const rec = await prisma.reconciliationAct.findFirst({
      where: { id, userId: request.user.sub },
      include: {
        organization: { include: { bankAccounts: true } },
        counterparty: true,
      },
    });
    if (!rec) throw Errors.notFound("Акт сверки");
    return { warnings: computePrintWarnings({ kind: "reconciliation", organization: rec.organization, counterparty: rec.counterparty }) };
  });
}
