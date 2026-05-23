// Sprint 10 — secrets encryption tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  encryptSecretBundle,
  decryptSecretBundle,
  requireEncryptionKey,
  hasDedicatedEncryptionKey,
} from "./secrets.js";

const ORIGINAL_KEY = process.env.APP_ENCRYPTION_KEY;

describe("secrets.maskSecret", () => {
  it("returns empty for empty input", () => {
    expect(maskSecret("")).toBe("");
  });

  it("dots-out short secrets", () => {
    expect(maskSecret("abc")).toBe("•••");
    expect(maskSecret("12345678")).toBe("••••••••");
  });

  it("keeps first 2 + last 4 with dots between for longer secrets", () => {
    const masked = maskSecret("sk-1234567890abcdef");
    expect(masked.startsWith("sk")).toBe(true);
    expect(masked.endsWith("cdef")).toBe(true);
    expect(masked).not.toContain("123456");
    expect(masked.length).toBeGreaterThanOrEqual(12);
  });
});

describe("secrets.encrypt/decrypt", () => {
  beforeEach(() => {
    // Use a dedicated 32+ char APP_ENCRYPTION_KEY for tests so they don't
    // depend on JWT_SECRET being set.
    process.env.APP_ENCRYPTION_KEY = "test-secrets-key-1234567890-1234567890";
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it("encryptSecret returns base64 and decrypt round-trips", () => {
    const enc = encryptSecret("sk-abcdef123456");
    expect(enc).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(decryptSecret(enc)).toBe("sk-abcdef123456");
  });

  it("empty input → empty output and roundtrips to empty", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("each encryption uses a fresh IV (ciphertext differs)", () => {
    const a = encryptSecret("same-plaintext");
    const b = encryptSecret("same-plaintext");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("tampered ciphertext fails auth-tag check (does not silently return garbage)", () => {
    const enc = encryptSecret("legit-value");
    // Flip a payload byte (after IV+tag).
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("wrong key cannot decrypt", () => {
    const enc = encryptSecret("payload");
    process.env.APP_ENCRYPTION_KEY = "different-key-789-fhsdjfhdsjf-12345678";
    expect(() => decryptSecret(enc)).toThrow();
  });
});

describe("secrets.encryptSecretBundle/decryptSecretBundle", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = "test-bundle-key-1234567890-1234567890";
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  it("roundtrips a multi-field bundle", () => {
    const enc = encryptSecretBundle({ token: "abc", secret: "xyz", password: "p@ss" });
    const dec = decryptSecretBundle(enc);
    expect(dec).toEqual({ token: "abc", secret: "xyz", password: "p@ss" });
  });

  it("drops empty values when encrypting", () => {
    const enc = encryptSecretBundle({ token: "abc", secret: "" });
    const dec = decryptSecretBundle(enc);
    expect(dec).toEqual({ token: "abc" });
  });

  it("empty bundle → empty string both ways", () => {
    expect(encryptSecretBundle({})).toBe("");
    expect(encryptSecretBundle({ a: "" })).toBe("");
    expect(decryptSecretBundle("")).toEqual({});
  });

  it("only string fields are preserved (numbers dropped via cleaning step)", () => {
    const enc = encryptSecretBundle({ token: "ok", noise: undefined as unknown as string });
    const dec = decryptSecretBundle(enc);
    expect(dec).toEqual({ token: "ok" });
  });
});

describe("secrets.requireEncryptionKey", () => {
  it("uses APP_ENCRYPTION_KEY when set", () => {
    process.env.APP_ENCRYPTION_KEY = "exclusively-app-key-1234567890-aaaaa";
    const key1 = requireEncryptionKey();
    expect(key1.length).toBe(32);
    expect(hasDedicatedEncryptionKey()).toBe(true);

    process.env.APP_ENCRYPTION_KEY = "different-app-key-9999999999-bbbbb";
    const key2 = requireEncryptionKey();
    expect(key1.equals(key2)).toBe(false);
  });

  it("falls back to JWT_SECRET when APP_ENCRYPTION_KEY is absent", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(hasDedicatedEncryptionKey()).toBe(false);
    const key = requireEncryptionKey();
    expect(key.length).toBe(32);
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = ORIGINAL_KEY;
  });
});
