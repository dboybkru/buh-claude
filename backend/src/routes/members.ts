// Sprint 9: members & invitations.
//
// Mounted at /api/v1/organizations/:organizationId/members from server.ts.
// All endpoints require the caller to be an active member of the org. Role
// gates on top of that:
//   - GET     : ACCOUNTANT+   (members:read)
//   - POST    : ADMIN+        (members:invite, with role restriction)
//   - PATCH   : ADMIN+        (members:update + canManageMember)
//   - DELETE  : ADMIN+        (members:remove + canManageMember + last-owner)
//
// Invitation flow (MVP without email delivery):
//   - POST { email, role } either creates an ACTIVE membership for a user
//     who is already registered with that email, or stores an INVITED row
//     with `invitedEmail` and userId=null. On the inviter's next login, an
//     auto-accept hook (see routes/auth.ts) flips matching INVITED rows
//     to ACTIVE for that user.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma, type OrganizationRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { Errors } from "../lib/api-error.js";
import { requireOrgAccess, getMembership } from "../lib/org-access.js";
import { canInviteRole, canManageMember } from "../lib/permissions.js";

const roleEnum = z.enum(["OWNER", "ADMIN", "ACCOUNTANT", "VIEWER"]);
const statusEnum = z.enum(["ACTIVE", "INVITED", "DISABLED"]);

const inviteSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  role: roleEnum,
});

const updateSchema = z.object({
  role: roleEnum.optional(),
  status: statusEnum.optional(),
});

/**
 * Count active OWNERs in the org. Used as the last-owner guard.
 */
async function activeOwnerCount(organizationId: string, excludeMemberId?: string): Promise<number> {
  return prisma.organizationMember.count({
    where: {
      organizationId,
      role: "OWNER",
      status: "ACTIVE",
      ...(excludeMemberId ? { NOT: { id: excludeMemberId } } : {}),
    },
  });
}

export async function membersRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // GET /organizations/:organizationId/members
  app.get<{ Params: { organizationId: string } }>("/", async (request) => {
    const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(request.params);
    await requireOrgAccess(prisma, request.user.sub, organizationId, "members:read");

    const rows = await prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: {
        user: { select: { id: true, email: true, fullName: true } },
        invitedBy: { select: { id: true, email: true, fullName: true } },
      },
    });
    return rows;
  });

  // POST /organizations/:organizationId/members/invite
  app.post<{ Params: { organizationId: string } }>("/invite", async (request, reply) => {
    const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(request.params);
    const actor = await requireOrgAccess(prisma, request.user.sub, organizationId, "members:invite");

    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    }
    const { email, role } = parsed.data;
    if (!canInviteRole(actor.role, role)) {
      throw Errors.forbidden(`Ваша роль (${actor.role}) не может приглашать ${role}`);
    }

    // If the email belongs to an existing user, attach them directly.
    const targetUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    try {
      const member = await prisma.$transaction(async (tx) => {
        if (targetUser) {
          // Reactivate / create an ACTIVE membership for the existing user.
          const existing = await tx.organizationMember.findFirst({
            where: { organizationId, userId: targetUser.id },
          });
          if (existing) {
            if (existing.status === "ACTIVE") {
              throw Errors.conflict("Пользователь уже состоит в организации");
            }
            return tx.organizationMember.update({
              where: { id: existing.id },
              data: { status: "ACTIVE", role, invitedById: request.user.sub, invitedEmail: email },
            });
          }
          return tx.organizationMember.create({
            data: {
              organizationId,
              userId: targetUser.id,
              role,
              status: "ACTIVE",
              invitedById: request.user.sub,
              invitedEmail: email,
            },
          });
        }
        // No user with that email yet — store an INVITED row keyed by email.
        // Note: @@unique(organizationId, userId) doesn't block multiple rows
        // with userId=NULL (PostgreSQL treats NULLs as distinct). The pending
        // row will be claimed on first login of the matching email.
        return tx.organizationMember.create({
          data: {
            organizationId,
            userId: null,
            role,
            status: "INVITED",
            invitedById: request.user.sub,
            invitedEmail: email,
          },
        });
      });
      return reply.code(201).send(member);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "Conflict", message: "Приглашение для этого пользователя уже есть" });
      }
      throw err;
    }
  });

  // PATCH /organizations/:organizationId/members/:memberId
  app.patch<{ Params: { organizationId: string; memberId: string } }>("/:memberId", async (request, reply) => {
    const { organizationId, memberId } = z
      .object({ organizationId: z.string().uuid(), memberId: z.string().uuid() })
      .parse(request.params);
    const actor = await requireOrgAccess(prisma, request.user.sub, organizationId, "members:update");

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "ValidationError", details: parsed.error.flatten() });
    }

    const target = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!target) throw Errors.notFound("Участник");

    if (!canManageMember(actor.role, target.role)) {
      throw Errors.forbidden(`Ваша роль (${actor.role}) не может управлять ${target.role}`);
    }
    // No self-promotion to OWNER; no self-disable for the last OWNER.
    if (target.userId === request.user.sub) {
      if (parsed.data.role && parsed.data.role !== actor.role) {
        throw Errors.forbidden("Нельзя сменить свою собственную роль");
      }
      if (parsed.data.status && parsed.data.status !== "ACTIVE") {
        throw Errors.forbidden("Нельзя отключить самого себя");
      }
    }
    // Only OWNER can promote to OWNER.
    if (parsed.data.role === "OWNER" && actor.role !== "OWNER") {
      throw Errors.forbidden("Назначить OWNER может только текущий OWNER");
    }
    // Last-owner guard if we'd remove an active OWNER from the org.
    const wouldDemote =
      target.role === "OWNER" &&
      target.status === "ACTIVE" &&
      ((parsed.data.role && parsed.data.role !== "OWNER") ||
        (parsed.data.status && parsed.data.status !== "ACTIVE"));
    if (wouldDemote) {
      const others = await activeOwnerCount(organizationId, memberId);
      if (others === 0) throw Errors.conflict("Нельзя убрать последнего OWNER");
    }

    const updated = await prisma.organizationMember.update({
      where: { id: memberId },
      data: {
        ...(parsed.data.role !== undefined ? { role: parsed.data.role as OrganizationRole } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      },
    });
    return updated;
  });

  // DELETE /organizations/:organizationId/members/:memberId
  app.delete<{ Params: { organizationId: string; memberId: string } }>("/:memberId", async (request) => {
    const { organizationId, memberId } = z
      .object({ organizationId: z.string().uuid(), memberId: z.string().uuid() })
      .parse(request.params);
    const actor = await requireOrgAccess(prisma, request.user.sub, organizationId, "members:remove");

    const target = await prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!target) throw Errors.notFound("Участник");

    if (!canManageMember(actor.role, target.role)) {
      throw Errors.forbidden(`Ваша роль (${actor.role}) не может удалить ${target.role}`);
    }
    if (target.userId === request.user.sub && target.role === "OWNER") {
      const others = await activeOwnerCount(organizationId, memberId);
      if (others === 0) throw Errors.conflict("Нельзя удалить последнего OWNER");
    }
    if (target.role === "OWNER" && target.status === "ACTIVE") {
      const others = await activeOwnerCount(organizationId, memberId);
      if (others === 0) throw Errors.conflict("Нельзя удалить последнего OWNER");
    }

    await prisma.organizationMember.delete({ where: { id: memberId } });
    return { ok: true };
  });
}
