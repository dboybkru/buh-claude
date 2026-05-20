import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { findPartyByInn, isDadataConfigured, suggestAddress, suggestParty } from "../lib/dadata.js";

const querySchema = z.object({ query: z.string().min(1).max(200), count: z.coerce.number().int().min(1).max(20).optional() });
const innSchema = z.object({ inn: z.string().regex(/^\d{10}(\d{2})?$/, "ИНН должен содержать 10 или 12 цифр") });

export async function dadataRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  function notConfigured(reply: import("fastify").FastifyReply) {
    return reply.code(503).send({
      error: "ServiceUnavailable",
      message: "DaData API не сконфигурирована. Задайте DADATA_API_KEY в .env.",
    });
  }

  app.get("/party/by-inn", async (request, reply) => {
    if (!isDadataConfigured()) return notConfigured(reply);
    const parsed = innSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    try {
      const suggestions = await findPartyByInn(parsed.data.inn);
      return { suggestions };
    } catch (err) {
      app.log.warn({ err }, "dadata findPartyByInn failed");
      return reply.code(502).send({ error: "BadGateway", message: "DaData недоступна" });
    }
  });

  app.get("/party/suggest", async (request, reply) => {
    if (!isDadataConfigured()) return notConfigured(reply);
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    try {
      const suggestions = await suggestParty(parsed.data.query, parsed.data.count);
      return { suggestions };
    } catch (err) {
      app.log.warn({ err }, "dadata suggestParty failed");
      return reply.code(502).send({ error: "BadGateway", message: "DaData недоступна" });
    }
  });

  app.get("/address/suggest", async (request, reply) => {
    if (!isDadataConfigured()) return notConfigured(reply);
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    try {
      const suggestions = await suggestAddress(parsed.data.query, parsed.data.count);
      return { suggestions };
    } catch (err) {
      app.log.warn({ err }, "dadata suggestAddress failed");
      return reply.code(502).send({ error: "BadGateway", message: "DaData недоступна" });
    }
  });
}
