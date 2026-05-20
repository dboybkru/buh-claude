// Симметричное шифрование секретов (apiKey AI и т.п.) перед хранением в БД.
// Ключ — JWT_SECRET (минимум 32 символа уже валидируется env-схемой).

import crypto from "node:crypto";
import { env } from "./env.js";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  return crypto.createHash("sha256").update(env.JWT_SECRET).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // формат: base64(iv|tag|enc)
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(stored: string): string {
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

/** Маскирует ключ для безопасной отдачи на фронт. */
export function maskSecret(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 8) return "•".repeat(plain.length);
  return plain.slice(0, 4) + "•".repeat(plain.length - 8) + plain.slice(-4);
}
