// Локальное хранилище файлов организации: логотип, печать, подпись.
// MVP — файлы в backend/uploads/<userId>/<orgId>/<kind>-<uuid>.<ext>.
// Чтение/удаление проверяет принадлежность файла пользователю.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { env } from "./env.js";
import { Errors } from "./api-error.js";

export type AssetKind = "logo" | "stamp" | "signature";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — лимит, как просили в Sprint 5

const UPLOADS_ROOT = path.isAbsolute(env.UPLOADS_DIR)
  ? env.UPLOADS_DIR
  : path.resolve(process.cwd(), env.UPLOADS_DIR);

export function uploadsRoot(): string {
  return UPLOADS_ROOT;
}

function extFromName(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg") return ".jpg";
  return ext;
}

function extFromMime(mime: string): string {
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return "";
}

export interface SaveAssetParams {
  userId: string;
  organizationId: string;
  kind: AssetKind;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface SavedAsset {
  /** Относительный путь, который сохраняем в Organization.<kind>. */
  relativePath: string;
  /** Абсолютный путь на диске. */
  absolutePath: string;
  size: number;
  mimeType: string;
}

export async function saveOrgAsset(p: SaveAssetParams): Promise<SavedAsset> {
  if (p.buffer.length === 0) throw Errors.validation("Файл пустой");
  if (p.buffer.length > MAX_BYTES) {
    throw Errors.validation(`Файл превышает максимальный размер ${MAX_BYTES / 1024 / 1024} MB`);
  }

  const ext = extFromName(p.filename) || extFromMime(p.mimeType);
  if (!ALLOWED_EXT.has(ext)) {
    throw Errors.validation(
      `Недопустимый формат файла. Разрешены: ${[...ALLOWED_EXT].join(", ")}`,
    );
  }
  if (!ALLOWED_MIME.has(p.mimeType)) {
    throw Errors.validation(
      `Недопустимый MIME-тип ${p.mimeType}. Разрешены: ${[...ALLOWED_MIME].join(", ")}`,
    );
  }

  const dir = path.join(UPLOADS_ROOT, p.userId, p.organizationId);
  await fs.mkdir(dir, { recursive: true });

  const uniq = crypto.randomBytes(8).toString("hex");
  const baseName = `${p.kind}-${uniq}${ext}`;
  const abs = path.join(dir, baseName);
  await fs.writeFile(abs, p.buffer);

  const rel = path.posix.join(p.userId, p.organizationId, baseName);
  return { relativePath: rel, absolutePath: abs, size: p.buffer.length, mimeType: p.mimeType };
}

/** Проверка, что относительный путь принадлежит данному пользователю.
 *  Защищает от path traversal: путь должен лежать внутри UPLOADS_ROOT/<userId>/. */
export function resolveSafeAssetPath(userId: string, relativePath: string): string | null {
  if (!relativePath) return null;
  const userRoot = path.resolve(UPLOADS_ROOT, userId);
  const abs = path.resolve(UPLOADS_ROOT, relativePath);
  // нормализованный путь должен начинаться с userRoot + sep
  if (abs !== userRoot && !abs.startsWith(userRoot + path.sep)) return null;
  return abs;
}

export async function readAsset(userId: string, relativePath: string): Promise<Buffer | null> {
  const abs = resolveSafeAssetPath(userId, relativePath);
  if (!abs) return null;
  try {
    return await fs.readFile(abs);
  } catch {
    return null;
  }
}

export async function deleteAsset(userId: string, relativePath: string | null | undefined): Promise<void> {
  if (!relativePath) return;
  const abs = resolveSafeAssetPath(userId, relativePath);
  if (!abs) return;
  try {
    await fs.unlink(abs);
  } catch {
    // файл уже удалён или не существовал — ок
  }
}

export function mimeTypeFor(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

export const ALLOWED_FILE_MIME = ALLOWED_MIME;
export const ALLOWED_FILE_EXT = ALLOWED_EXT;
export const MAX_FILE_BYTES = MAX_BYTES;
