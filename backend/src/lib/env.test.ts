import { describe, it, expect } from "vitest";
import { envSchema } from "./env.js";

// Тесты валидаторов env Schema. НЕ запускают парсинг process.env (это сделано в env.ts уже).
// Проверяем что схема корректно отклоняет невалидные значения и не раскрывает их в ошибке.

const validBase = {
  NODE_ENV: "test",
  PORT: "3001",
  DATABASE_URL: "postgresql://u:p@localhost:5432/d?schema=public",
  JWT_SECRET: "a-very-long-secret-for-jwt-min-32-chars-1234",
};

describe("env schema", () => {
  it("валидный набор парсится", () => {
    const r = envSchema.safeParse(validBase);
    expect(r.success).toBe(true);
  });

  it("DATABASE_URL обязателен и должен быть URL", () => {
    const r1 = envSchema.safeParse({ ...validBase, DATABASE_URL: undefined });
    expect(r1.success).toBe(false);

    const r2 = envSchema.safeParse({ ...validBase, DATABASE_URL: "not-a-url" });
    expect(r2.success).toBe(false);
    if (!r2.success) {
      const msg = r2.error.flatten().fieldErrors.DATABASE_URL?.[0] ?? "";
      expect(msg).toMatch(/URL/i);
    }
  });

  it("JWT_SECRET минимум 32 символа", () => {
    const r = envSchema.safeParse({ ...validBase, JWT_SECRET: "too-short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.flatten().fieldErrors.JWT_SECRET?.[0] ?? "";
      expect(msg).toMatch(/32/);
    }
  });

  it("ошибки не содержат значений секретов в plain", () => {
    // Если секрет короткий — мы НЕ должны видеть его в сообщении (только описание длины).
    const r = envSchema.safeParse({ ...validBase, JWT_SECRET: "leaked-secret" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const full = JSON.stringify(r.error.flatten());
      expect(full).not.toContain("leaked-secret");
    }
  });

  it("LOG_LEVEL ограничен enum", () => {
    const r = envSchema.safeParse({ ...validBase, LOG_LEVEL: "loud" });
    expect(r.success).toBe(false);
  });

  it("NODE_ENV ограничен enum", () => {
    const r = envSchema.safeParse({ ...validBase, NODE_ENV: "staging" });
    expect(r.success).toBe(false);
  });

  it("опциональные поля имеют дефолты", () => {
    const r = envSchema.safeParse(validBase);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.PORT).toBe(3001);
      expect(r.data.UPLOADS_DIR).toBe("./uploads");
      expect(r.data.LOG_LEVEL).toBe("info");
      expect(r.data.CORS_ORIGIN).toBe("http://localhost:5173");
    }
  });
});
