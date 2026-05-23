// Sprint 9: helpers for resolving the caller's access to an organization.
//
// Every request that touches organization data should go through
// requireOrgAccess() so we never accidentally rely on the legacy
// `Organization.userId` ownership shortcut.
//
// The helpers are thin wrappers around Prisma so callers can write:
//
//   const { role } = await requireOrgAccess(prisma, userId, orgId);
//   if (!hasPermission(role, "data:write")) throw Errors.forbidden(...);
//
// or, when a list endpoint needs to scope by orgs the user is a member of:
//
//   const orgIds = await getUserOrgIds(prisma, userId);
//   const where = { organizationId: { in: orgIds } };

import type { OrganizationRole, OrganizationMemberStatus, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma.js";
import { Errors } from "./api-error.js";
import { hasPermission, type Permission, type Role } from "./permissions.js";

type Db = Pick<PrismaClient, "organizationMember" | "organization">;

export interface MembershipInfo {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  status: OrganizationMemberStatus;
}

/**
 * Returns the caller's ACTIVE membership for the given organization, or null
 * if there is none / it's disabled / it's still INVITED. INVITED memberships
 * are deliberately not active access — they need to be accepted first.
 */
export async function getMembership(
  db: Db,
  userId: string,
  organizationId: string,
): Promise<MembershipInfo | null> {
  const m = await db.organizationMember.findFirst({
    where: { organizationId, userId, status: "ACTIVE" },
    select: { id: true, organizationId: true, userId: true, role: true, status: true },
  });
  if (!m || !m.userId) return null;
  return {
    id: m.id,
    organizationId: m.organizationId,
    userId: m.userId,
    role: m.role,
    status: m.status,
  };
}

/**
 * Asserts the caller is an ACTIVE member of `organizationId` and (optionally)
 * has the given permission. Throws:
 *   - 404 if the organization doesn't exist (we don't tell unknown users
 *     whether an organization id is real)
 *   - 403 if the user has no active membership
 *   - 403 if a `permission` was supplied and the user's role doesn't have it
 *
 * Returns the membership so callers can log / use the role.
 */
export async function requireOrgAccess(
  db: Db,
  userId: string,
  organizationId: string,
  permission?: Permission,
): Promise<MembershipInfo> {
  // Privacy: do not reveal whether the organization exists to non-members.
  // We treat "no org" and "not a member" both as 404. Only insufficient
  // role of an existing member is 403 — at that point the user already
  // knows the organization exists.
  const membership = await getMembership(db, userId, organizationId);
  if (!membership) {
    throw Errors.notFound("Организация");
  }
  if (permission && !hasPermission(membership.role, permission)) {
    throw Errors.forbidden(`Недостаточно прав (нужно: ${permission})`);
  }
  return membership;
}

/**
 * Convenience: throw if the caller's role doesn't satisfy `permission`. Used
 * when we already loaded the membership (e.g. inside a transaction).
 */
export function requirePermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw Errors.forbidden(`Недостаточно прав (нужно: ${permission})`);
  }
}

/**
 * Returns every organizationId the user is an ACTIVE member of. Used by list
 * endpoints to scope queries. Empty array → user has no organizations and
 * should see nothing (not 403 — a fresh user with no memberships is fine).
 */
export async function getUserOrgIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { organizationId: true },
  });
  return rows.map((r) => r.organizationId);
}

/**
 * Sprint 9 compromise: for user-scoped entities (Counterparty, Nomenclature,
 * ContractTemplate without orgId) we don't have an organization to check
 * against. Instead, allow the write if the caller has data:write in ANY
 * organization they're a member of. VIEWERs and outsiders are rejected.
 *
 * Special case: a user with NO memberships at all (e.g. just registered,
 * hasn't created their organization yet) is allowed to write. They have
 * no organization to violate RBAC against, and onboarding (creating the
 * first counterparty before/after the first org) shouldn't be blocked.
 */
export async function assertCanWriteData(userId: string): Promise<void> {
  const rows = await prisma.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { role: true },
  });
  if (rows.length === 0) return;
  for (const r of rows) {
    if (hasPermission(r.role, "data:write")) return;
  }
  throw Errors.forbidden("Недостаточно прав (нужно: data:write)");
}

/**
 * Backward-compat helper for "user-scoped" entities that don't have an
 * organizationId column (Counterparty, Nomenclature, ContractTemplate without
 * orgId, AiSettings). Returns the set of userIds whose data the caller can
 * read — i.e. owners of every organization the caller is an ACTIVE member of,
 * plus the caller themselves.
 *
 * This is a *transitional* compromise. The right long-term fix is to add an
 * organizationId column to those entities and key off it directly. Until then,
 * filtering by `userId IN (accessibleUserIds(callerId))` is enough to make
 * invited members see their owner's counterparties/nomenclature.
 *
 * For an ACCOUNTANT in org A owned by user_owner: returns [callerId, user_owner].
 * For an OWNER: returns [callerId] (they ARE the owner).
 */
export async function getAccessibleUserIds(db: Db, userId: string): Promise<string[]> {
  const orgIds = await getUserOrgIds(db, userId);
  if (orgIds.length === 0) return [userId];

  // Use Organization.userId (the legacy ownership column) to find the
  // original creator of each org. They are the user whose Counterparty /
  // Nomenclature / etc. rows the caller should be allowed to read.
  const orgs = await db.organization.findMany({
    where: { id: { in: orgIds } },
    select: { userId: true },
  });
  const ids = new Set<string>(orgs.map((o) => o.userId));
  ids.add(userId);
  return [...ids];
}
