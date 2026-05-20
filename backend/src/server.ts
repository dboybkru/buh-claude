import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "production"
          ? undefined
          : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
    },
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
    credentials: true,
  });

  app.get("/api/v1/health", async () => ({
    status: "ok",
    service: "buhclaude-api",
    timestamp: new Date().toISOString(),
  }));

  return app;
}
