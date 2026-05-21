// In-memory store для preview-сессий банковского импорта.
// MVP-ограничение: переживает только текущий процесс. После перезапуска backend
// все pending-превью исчезают. Документировано в README.
//
// TTL по умолчанию — 30 минут. Просроченные записи удаляются лениво при доступе.

import { randomUUID } from "node:crypto";
import type { PreviewMeta, PreviewPayload } from "./types.js";

interface StoredPreview {
  ownerUserId: string;
  meta: PreviewMeta;
  payload: PreviewPayload;
}

const TTL_MS = 30 * 60 * 1000;
const store = new Map<string, StoredPreview>();

function gc(): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.meta.expiresAt < now) store.delete(k);
  }
}

export function savePreview(params: {
  userId: string;
  organizationId: string;
  bankAccountId: string | null;
  fileName: string;
  payload: Omit<PreviewPayload, "importId">;
}): { importId: string; meta: PreviewMeta } {
  gc();
  const importId = randomUUID();
  const now = Date.now();
  const meta: PreviewMeta = {
    organizationId: params.organizationId,
    bankAccountId: params.bankAccountId,
    fileName: params.fileName,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  const payload: PreviewPayload = { importId, ...params.payload };
  store.set(importId, { ownerUserId: params.userId, meta, payload });
  return { importId, meta };
}

export function getPreview(
  importId: string,
  userId: string,
): { meta: PreviewMeta; payload: PreviewPayload } | null {
  gc();
  const found = store.get(importId);
  if (!found) return null;
  if (found.ownerUserId !== userId) return null;   // защита от cross-user доступа
  if (found.meta.expiresAt < Date.now()) {
    store.delete(importId);
    return null;
  }
  return { meta: found.meta, payload: found.payload };
}

export function dropPreview(importId: string): void {
  store.delete(importId);
}

/** Только для тестов: очистить всё. */
export function _resetStore(): void {
  store.clear();
}
