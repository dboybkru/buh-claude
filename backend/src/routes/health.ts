// Sprint 7: health + readiness endpoints.
// /api/v1/health   — публичный, без auth, лёгкий: статус + версия + uptime.
// /api/v1/ready    — публичный, проверяет БД + uploads dir. Возвращает 200 при ok,
//                    503 при degraded/error. Используется в Docker healthcheck / K8s.

import fs from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { uploadsRoot } from "../lib/uploads.js";

// Версия из package.json — статически считываем при загрузке модуля
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(here, "..", "..", "package.json");
let serviceVersion = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
  serviceVersion = pkg.version ?? "0.0.0";
} catch {
  /* fallback */
}

const SERVICE_NAME = "buhclaude-api";

export async function healthRoutes(app: FastifyInstance) {
  /**
   * Лёгкий health — не проверяет внешние зависимости. Подходит для liveness-проб.
   * Никогда не возвращает 500 при работающем процессе.
   */
  app.get("/health", async () => ({
    status: "ok" as const,
    service: SERVICE_NAME,
    version: serviceVersion,
    uptimeSec: Math.round(process.uptime()),
    nodeEnv: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  }));

  /**
   * Readiness — проверяет БД и доступность uploads dir. Возвращает 503 при
   * частичной/полной деградации. Подходит для readiness-проб K8s.
   * Не раскрывает секретов в check-сообщениях — только статус.
   */
  app.get("/ready", async (_request, reply) => {
    const checks: Record<string, "ok" | "error"> = {};

    // 1. PostgreSQL — лёгкий SELECT 1, без захвата строк/таблиц
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }

    // 2. Uploads directory — должен существовать и быть доступным на чтение
    try {
      await fs.access(uploadsRoot());
      checks.uploads = "ok";
    } catch {
      checks.uploads = "error";
    }

    const allOk = Object.values(checks).every((v) => v === "ok");
    const status = allOk ? "ok" : "degraded";
    reply.code(allOk ? 200 : 503);
    return {
      status,
      service: SERVICE_NAME,
      version: serviceVersion,
      checks,
      timestamp: new Date().toISOString(),
    };
  });
}
