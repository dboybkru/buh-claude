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

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
    },
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  });

  await app.register(jwtPlugin);

  app.get("/api/v1/health", async () => ({
    status: "ok",
    service: "buhclaude-api",
    timestamp: new Date().toISOString(),
  }));

  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(organizationsRoutes, { prefix: "/api/v1/organizations" });
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

  return app;
}
