// Sprint 10 — Secret encryption for IntegrationSetting / SystemSetting.
//
// AES-256-GCM with a per-secret random 12-byte IV. Auth tag is bundled
// alongside the ciphertext: base64(iv | tag | ciphertext).
//
// Key source priority:
//   1. APP_ENCRYPTION_KEY env var (preferred; rotated independently of JWT)
//   2. JWT_SECRET fallback (so deployments without APP_ENCRYPTION_KEY can
//      still encrypt system settings — uses the same derivation as the
//      legacy lib/crypto.ts for AI apiKey blobs).
//
// IMPORTANT: rotating the key invalidates every existing stored secret.
// Treat APP_ENCRYPTION_KEY as long-lived; if rotation is unavoidable,
// re-enter every secret in /admin/system after deploy.

import crypto from "node:crypto";
import { env } from "./env.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Derives the 32-byte AES key from the configured source. Throws if neither
 * APP_ENCRYPTION_KEY nor JWT_SECRET is usable — but env.ts already enforces
 * JWT_SECRET ≥ 32 chars at boot, so this only fires in tests with broken env.
 */
export function requireEncryptionKey(): Buffer {
  // APP_ENCRYPTION_KEY may be base64 (32+ bytes) or a long random string.
  const raw = process.env.APP_ENCRYPTION_KEY ?? "";
  if (raw.length > 0) {
    // Accept either raw base64 (decode → must be 32 bytes) or arbitrary string
    // (hash to 32 bytes). We hash regardless — sha256(s) gives a consistent
    // 32-byte key whether s is base64 or not.
    return crypto.createHash("sha256").update(raw).digest();
  }
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 32) {
    return crypto.createHash("sha256").update(env.JWT_SECRET).digest();
  }
  throw new Error(
    "Не задан APP_ENCRYPTION_KEY (или JWT_SECRET ≥ 32 chars) — нечем шифровать секреты",
  );
}

/** True when APP_ENCRYPTION_KEY is set explicitly (preferred prod state). */
export function hasDedicatedEncryptionKey(): boolean {
  return (process.env.APP_ENCRYPTION_KEY ?? "").length > 0;
}

/** Encrypts a non-empty plaintext. Empty input → empty string (no ciphertext). */
export function encryptSecret(plain: string): string {
  if (plain.length === 0) return "";
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, requireEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/**
 * Decrypts a value produced by encryptSecret(). Empty input → empty string.
 * Throws on tampered ciphertext (GCM auth-tag mismatch) or wrong key.
 */
export function decryptSecret(stored: string): string {
  if (stored.length === 0) return "";
  const buf = Buffer.from(stored, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Зашифрованное значение слишком короткое");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, requireEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

/**
 * Masks a secret for safe display: keep first 2 and last 4 chars,
 * dots in between. Short secrets become "•" repeated. Empty → "".
 */
export function maskSecret(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 8) return "•".repeat(plain.length);
  return plain.slice(0, 2) + "•".repeat(Math.max(6, plain.length - 6)) + plain.slice(-4);
}

/**
 * Helper for JSON secret bundles: encrypts a plain object (e.g.
 * `{ token: "...", secret: "..." }`) and returns ciphertext. Empty/no-keys
 * object → empty string.
 */
export function encryptSecretBundle(bundle: Record<string, string>): string {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(bundle)) {
    if (typeof v === "string" && v.length > 0) cleaned[k] = v;
  }
  if (Object.keys(cleaned).length === 0) return "";
  return encryptSecret(JSON.stringify(cleaned));
}

/**
 * Decrypts the bundle produced by encryptSecretBundle. Empty input → {}.
 * Throws on corrupted data.
 */
export function decryptSecretBundle(stored: string): Record<string, string> {
  if (stored.length === 0) return {};
  const json = decryptSecret(stored);
  const parsed = JSON.parse(json) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Зашифрованный bundle не объект");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
