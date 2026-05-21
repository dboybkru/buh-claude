// Sprint 6A: безопасный executor для двух типов action.
// Перед каждым действием — проверка owner / cross-organization.
// Бизнес-логика повторно использует существующие helpers (numbering, document-items).

import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { nextDocumentNumber } from "../numbering.js";
import { prepareItems, itemCreateData } from "../document-items.js";
import {
  vatRateToNumber,
  type Action,
  type AppliedAction,
  type FailedAction,
  type CreateCounterpartyPayload,
  type CreateInvoicePayload,
} from "./schemas.js";

/** Контракт ошибки executor — содержит сообщение и кодируется как FailedAction. */
class ExecutorError extends Error {}

async function ensureOrganizationOwner(userId: string, organizationId: string): Promise<void> {
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, userId },
    select: { id: true, inn: true },
  });
  if (!org) throw new ExecutorError("Организация не найдена или принадлежит другому пользователю");
}

async function ensureCounterpartyOwner(userId: string, counterpartyId: string): Promise<{ id: string; inn: string }> {
  const cp = await prisma.counterparty.findFirst({
    where: { id: counterpartyId, userId },
    select: { id: true, inn: true },
  });
  if (!cp) throw new ExecutorError("Контрагент не найден или принадлежит другому пользователю");
  return cp;
}

async function executeCreateCounterparty(
  userId: string,
  payload: CreateCounterpartyPayload,
): Promise<{ targetType: "counterparty"; targetId: string }> {
  await ensureOrganizationOwner(userId, payload.organizationId);

  // Проверка: не пытаемся создать contractor с теми же реквизитами, что у организации пользователя
  const ownOrg = await prisma.organization.findFirst({
    where: { userId, inn: payload.inn, ...(payload.kpp ? { kpp: payload.kpp } : {}) },
    select: { id: true },
  });
  if (ownOrg) {
    throw new ExecutorError("Нельзя создать контрагента, совпадающего с собственной организацией");
  }

  // Проверка дубля
  const existing = await prisma.counterparty.findFirst({ where: { userId, inn: payload.inn } });
  if (existing) {
    throw new ExecutorError(`Контрагент с ИНН ${payload.inn} уже существует (id ${existing.id})`);
  }

  const cp = await prisma.counterparty.create({
    data: {
      userId,
      type: payload.inn.length === 12 ? "IP" : "OOO",
      inn: payload.inn,
      kpp: payload.kpp ?? null,
      name: payload.name,
      fullName: payload.name,
      legalAddress: payload.legalAddress ?? null,
      phone: payload.phone ?? null,
      email: payload.email ?? null,
    },
  });
  return { targetType: "counterparty", targetId: cp.id };
}

async function executeCreateInvoice(
  userId: string,
  payload: CreateInvoicePayload,
): Promise<{ targetType: "invoice"; targetId: string }> {
  await ensureOrganizationOwner(userId, payload.organizationId);
  const cp = await ensureCounterpartyOwner(userId, payload.counterpartyId);
  void cp;

  if (payload.items.length === 0) throw new ExecutorError("Нужна хотя бы одна позиция");

  // Конвертация AI-payload в формат existing prepareItems
  const itemsInput = payload.items.map((it, idx) => ({
    sortOrder: idx + 1,
    name: it.name,
    unit: it.unit,
    unitCode: "796",
    quantity: it.quantity,
    price: it.price,
    vatRate: vatRateToNumber(it.vatRate),
    nomenclatureId: null,
    countryCode: null,
    countryName: null,
    customsDecl: null,
  }));

  const vatIncluded = true; // соглашение: AI всегда работает в режиме «НДС включён в цену»
  const { prepared, totals } = prepareItems(itemsInput, vatIncluded);
  const date = new Date(payload.date);
  const dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
  const year = date.getFullYear();

  const result = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, userId, payload.organizationId, "INVOICE", year);
    const inv = await tx.invoice.create({
      data: {
        userId,
        organizationId: payload.organizationId,
        counterpartyId: payload.counterpartyId,
        number,
        date,
        dueDate,
        currency: "RUB",
        status: "DRAFT",
        vatRate: prepared[0]?.vatRate ?? 22,
        vatIncluded,
        subtotal: Number(totals.subtotal),
        vatAmount: Number(totals.vatAmount),
        total: Number(totals.total),
        notes: payload.note ?? null,
      },
    });
    await tx.documentItem.createMany({
      data: prepared.map((p) => itemCreateData(p, userId, "INVOICE", inv.id)),
    });
    return inv;
  });

  return { targetType: "invoice", targetId: result.id };
}

/** Выполняет один action и возвращает результат либо ошибку. */
export async function executeAction(
  userId: string,
  action: Action,
): Promise<{ targetType: "counterparty" | "invoice"; targetId: string }> {
  try {
    switch (action.type) {
      case "create_counterparty":
        return await executeCreateCounterparty(userId, action.payload);
      case "create_invoice":
        return await executeCreateInvoice(userId, action.payload);
    }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ExecutorError("Конфликт уникальности (вероятно, дубль). Пересмотрите данные.");
    }
    throw err;
  }
}

/** Утилита для удобного формирования FailedAction. */
export function asFailedAction(action: Action, error: unknown): FailedAction {
  const message = error instanceof Error ? error.message : String(error);
  return { id: action.id, actionType: action.type, error: message };
}

/** Маркер: совпадает targetType с тем, что вернул executor. */
export function toAppliedAction(action: Action, result: { targetType: "counterparty" | "invoice"; targetId: string }): AppliedAction {
  return { id: action.id, actionType: action.type, targetType: result.targetType, targetId: result.targetId };
}
