import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { env } from "./lib/env.js";
import jwtPlugin from "./plugins/jwt.js";
import { authRoutes } from "./routes/auth.js";
import { organizationsRoutes } from "./routes/organizations.js";
import { counterpartiesRoutes } from "./routes/counterparties.js";
import { nomenclatureRoutes } from "./routes/nomenclature.js";
import { contractsRoutes } from "./routes/contracts.js";
import { bankAccountsRoutes } from "./routes/bankAccounts.js";
import { invoicesRoutes } from "./routes/invoices.js";
import { actsRoutes } from "./routes/acts.js";
import { updsRoutes } from "./routes/upds.js";
import { waybillsRoutes } from "./routes/waybills.js";
import { dadataRoutes } from "./routes/dadata.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { exportRoutes } from "./routes/export.js";
import { paymentsRoutes } from "./routes/payments.js";
import { reconciliationsRoutes } from "./routes/reconciliations.js";
import { aiRoutes } from "./routes/ai.js";
import { importsRoutes } from "./routes/imports.js";
import { bankImportRoutes } from "./routes/bank-import.js";
import { filesRoutes } from "./routes/files.js";
import { contractTemplatesRoutes } from "./routes/contract-templates.js";
import { healthRoutes } from "./routes/health.js";
import { membersRoutes } from "./routes/members.js";
import { adminSystemRoutes } from "./routes/admin-system.js";
import { ApiError, normalizeErrorPayload } from "./lib/api-error.js";
import { ZodError } from "zod";
import crypto from "node:crypto";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    // Sprint 7: requestId через crypto.randomUUID для трассировки запросов в логах.
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "reqId",
    logger: {
      level: env.LOG_LEVEL,
      // Sprint 7: redact чувствительных полей чтобы JWT / apiKey / пароли
      // НИКОГДА не попадали в логи в plain-виде.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["x-api-key"]',
          "headers.authorization",
          "headers.cookie",
          'headers["x-api-key"]',
          "*.apiKey",
          "*.password",
          "*.passwordHash",
          "*.token",
          "*.jwt",
          "*.secret",
          "body.apiKey",
          "body.password",
          "body.token",
        ],
        censor: "[REDACTED]",
      },
      transport:
        env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname,reqId" } },
    },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  });

  // Единый формат ошибок: { error: { code, message, details? } }
  app.setErrorHandler((err: unknown, request, reply) => {
    if (err instanceof ApiError) {
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: "ValidationError", message: "Невалидные параметры запроса", details: err.flatten() },
      });
    }
    const e = err as { statusCode?: number; code?: string; message?: string; stack?: string };
    const status = e.statusCode ?? 500;
    if (status >= 500) request.log.error({ err }, "Unhandled server error");
    // Sprint 7: в production НЕ отдаём stack и не раскрываем внутренние детали
    // 500-ошибок наружу. Stack остаётся в логах (см. request.log.error выше).
    const isProd = env.NODE_ENV === "production";
    const outMessage = status >= 500 && isProd ? "Внутренняя ошибка сервера" : (e.message || "Произошла ошибка");
    return reply.code(status).send({
      error: {
        code: e.code ?? (status >= 500 ? "InternalError" : "BadRequest"),
        message: outMessage,
        ...(isProd || status >= 500 ? {} : {}), // stack не выдаём в любом случае
      },
    });
  });

  // Конвертация легаси-формата плоских ошибок ({error, message, details}) в { error: { code, message, details } }
  app.addHook("onSend", async (_request, reply, payload) => {
    if (reply.statusCode < 400 || typeof payload !== "string") return payload;
    try {
      const parsed = JSON.parse(payload);
      const normalized = normalizeErrorPayload(parsed);
      if (normalized) return JSON.stringify(normalized);
    } catch {
      // не JSON — пропускаем (например, HTML/PDF/CSV ответы редко имеют ошибки на этом этапе)
    }
    return payload;
  });

  await app.register(jwtPlugin);

  // Sprint 7: онlogResponse hook добавляет userId / orgId в логи запроса
  // (если есть в JWT). Помогает корреляции в production.
  app.addHook("onRequest", async (request) => {
    try {
      const auth = request.headers.authorization;
      if (auth && auth.startsWith("Bearer ")) {
        const payload = app.jwt.decode<{ sub?: string; orgId?: string }>(auth.slice("Bearer ".length));
        if (payload) {
          request.log = request.log.child({
            ...(payload.sub ? { userId: payload.sub } : {}),
            ...(payload.orgId ? { orgId: payload.orgId } : {}),
          });
        }
      }
    } catch {
      // битый jwt — auth-handler сам разберётся, лог-обогащение пропускаем
    }
  });

  // Health / readiness (Sprint 7) — публично, без auth
  await app.register(healthRoutes, { prefix: "/api/v1" });

  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(organizationsRoutes, { prefix: "/api/v1/organizations" });
  // Sprint 9: RBAC — members CRUD nested under each organization.
  await app.register(membersRoutes, { prefix: "/api/v1/organizations/:organizationId/members" });
  await app.register(counterpartiesRoutes, { prefix: "/api/v1/counterparties" });
  await app.register(nomenclatureRoutes, { prefix: "/api/v1/nomenclature" });
  await app.register(contractsRoutes, { prefix: "/api/v1/contracts" });
  await app.register(bankAccountsRoutes, { prefix: "/api/v1/organizations/:organizationId/bank-accounts" });
  await app.register(invoicesRoutes, { prefix: "/api/v1/invoices" });
  await app.register(actsRoutes, { prefix: "/api/v1/acts" });
  await app.register(updsRoutes, { prefix: "/api/v1/upds" });
  await app.register(waybillsRoutes, { prefix: "/api/v1/waybills" });
  await app.register(dadataRoutes, { prefix: "/api/v1/dadata" });
  await app.register(dashboardRoutes, { prefix: "/api/v1/dashboard" });
  await app.register(exportRoutes, { prefix: "/api/v1/export" });
  await app.register(paymentsRoutes, { prefix: "/api/v1/payments" });
  await app.register(reconciliationsRoutes, { prefix: "/api/v1/reconciliations" });
  await app.register(aiRoutes, { prefix: "/api/v1/ai" });
  await app.register(importsRoutes, { prefix: "/api/v1/imports" });
  await app.register(bankImportRoutes, { prefix: "/api/v1/bank-import" });
  await app.register(filesRoutes, { prefix: "/api/v1/files" });
  await app.register(contractTemplatesRoutes, { prefix: "/api/v1/contract-templates" });
  // Sprint 10: platform-admin-only system integrations (DaData/AI/SMTP/APP).
  await app.register(adminSystemRoutes, { prefix: "/api/v1/admin/system" });

  return app;
}
