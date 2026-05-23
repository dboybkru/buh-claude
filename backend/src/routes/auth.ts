import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hashPassword, verifyPassword, generateSessionToken } from "../lib/auth.js";
import { env } from "../lib/env.js";

const registerSchema = z.object({
  email: z.string().email("Некорректный email"),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов"),
  fullName: z.string().min(2, "Укажите ФИО"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function sessionExpiry(): Date {
  // Совпадает с временем жизни JWT (по умолчанию 7 дней)
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

/**
 * Sprint 9: when a user logs in / registers, claim any INVITED memberships
 * that were created for their email before the user existed. We attach userId
 * to the row and flip status to ACTIVE. Idempotent and safe to run on every
 * login.
 */
async function claimInvitations(userId: string, email: string): Promise<void> {
  const pending = await prisma.organizationMember.findMany({
    where: { userId: null, invitedEmail: email, status: "INVITED" },
    select: { id: true, organizationId: true },
  });
  if (pending.length === 0) return;
  for (const row of pending) {
    // Skip if the user already has an ACTIVE membership in this org.
    const existing = await prisma.organizationMember.findFirst({
      where: { organizationId: row.organizationId, userId },
    });
    if (existing) {
      // Drop the stale invite — the user already has access through another row.
      await prisma.organizationMember.delete({ where: { id: row.id } }).catch(() => {});
      continue;
    }
    await prisma.organizationMember.update({
      where: { id: row.id },
      data: { userId, status: "ACTIVE" },
    });
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    }
    const { email, password, fullName } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "Conflict", message: "Пользователь с таким email уже существует" });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, fullName },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
    });

    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    await prisma.userSession.create({
      data: {
        userId: user.id,
        token: generateSessionToken(),
        userAgent: request.headers["user-agent"] ?? null,
        ipAddress: request.ip,
        expiresAt: sessionExpiry(),
      },
    });
    await claimInvitations(user.id, user.email);

    return reply.code(201).send({ user, token });
  });

  app.post("/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return reply.code(401).send({ error: "Unauthorized", message: "Неверный email или пароль" });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "Unauthorized", message: "Неверный email или пароль" });
    }

    const token = app.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    await prisma.userSession.create({
      data: {
        userId: user.id,
        token: generateSessionToken(),
        userAgent: request.headers["user-agent"] ?? null,
        ipAddress: request.ip,
        expiresAt: sessionExpiry(),
      },
    });
    await claimInvitations(user.id, user.email);

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
      token,
    });
  });

  app.get("/me", { onRequest: [app.authenticate] }, async (request, reply) => {
    const claims = request.user;
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
    });
    if (!user) {
      return reply.code(404).send({ error: "NotFound", message: "Пользователь не найден" });
    }
    return { user };
  });

  app.post("/logout", { onRequest: [app.authenticate] }, async (request) => {
    // Без серверного хранилища активных JWT мы только инвалидируем все сессии пользователя в БД.
    // На клиенте токен всё равно нужно стереть.
    await prisma.userSession.deleteMany({ where: { userId: request.user.sub } });
    return { ok: true };
  });
}
