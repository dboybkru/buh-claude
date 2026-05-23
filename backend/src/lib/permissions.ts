// Sprint 9: RBAC matrix and helpers.
//
// Permission model is centred on OrganizationMember:
//   OWNER       — full control over the organization, including settings and
//                 member management. Cannot be removed if it would leave the
//                 organization without an active OWNER.
//   ADMIN       — almost everything OWNER can, except removing or demoting
//                 an OWNER and deleting the organization itself.
//   ACCOUNTANT  — operational data: documents, counterparties (scoped to
//                 their working set), payments, bank import, AI confirm.
//                 Cannot touch organization settings or members.
//   VIEWER      — read-only access to everything in the organization. No
//                 writes, no AI confirm, no file upload, no member changes.
//
// Permissions are defined as a flat string union so callers can grep for
// usages and so the matrix is easy to read in a single screen.

import type { OrganizationRole } from "@prisma/client";

export type Role = OrganizationRole;

/** Every action that is gated by RBAC. Keep names short and grep-friendly. */
export type Permission =
  // Organization itself
  | "org:read"
  | "org:update"          // edit organization settings (vat, addresses, print)
  | "org:delete"          // delete the whole organization
  // Members
  | "members:read"
  | "members:invite"
  | "members:update"      // change role / re-enable
  | "members:remove"      // remove / disable
  // Operational data (CRUD across counterparties, nomenclature, documents,
  // payments, bank import, reconciliations, contracts, contract templates)
  | "data:read"
  | "data:write"
  // Files (organization assets — logo / stamp / signature)
  | "files:read"
  | "files:upload"
  | "files:delete"
  // Print settings live on Organization, but conceptually they are admin-only
  | "print:settings"
  // AI
  | "ai:settings"         // change provider / api key / model
  | "ai:chat"             // open chat and produce DRAFT action plans
  | "ai:confirm"          // confirm action plan (executes writes)
  | "ai:audit"            // view audit log
  // Bank import
  | "bank:import"
  // Payments
  | "payments:write";

/** Order matters: higher roles inherit everything below them. */
export const ROLE_ORDER: Role[] = ["VIEWER", "ACCOUNTANT", "ADMIN", "OWNER"];

function roleRank(role: Role): number {
  return ROLE_ORDER.indexOf(role);
}

/** True if `role` is at least as privileged as `min`. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return roleRank(role) >= roleRank(min);
}

/**
 * Permission matrix. Each permission lists the MINIMUM role that has it.
 * Higher roles automatically inherit via roleAtLeast(). If a permission is
 * not present, no role has it.
 */
const PERMISSION_MIN_ROLE: Record<Permission, Role> = {
  "org:read":       "VIEWER",
  "org:update":     "OWNER",
  "org:delete":     "OWNER",

  "members:read":   "ACCOUNTANT",   // accountants need to see who else is in the org
  "members:invite": "ADMIN",
  "members:update": "ADMIN",
  "members:remove": "ADMIN",

  "data:read":      "VIEWER",
  "data:write":     "ACCOUNTANT",

  "files:read":     "VIEWER",
  "files:upload":   "ADMIN",
  "files:delete":   "ADMIN",

  "print:settings": "ADMIN",

  "ai:settings":    "ADMIN",
  "ai:chat":        "ACCOUNTANT",
  "ai:confirm":     "ACCOUNTANT",
  "ai:audit":       "ACCOUNTANT",

  "bank:import":    "ACCOUNTANT",
  "payments:write": "ACCOUNTANT",
};

/** Does `role` have `permission`? */
export function hasPermission(role: Role, permission: Permission): boolean {
  return roleAtLeast(role, PERMISSION_MIN_ROLE[permission]);
}

/**
 * Can `actor` manage `target`? Used by member endpoints to gate role changes
 * and removals. Rules:
 *   - OWNER can manage anyone.
 *   - ADMIN can manage ADMIN / ACCOUNTANT / VIEWER, but NOT OWNER.
 *   - Anyone else cannot manage members.
 *
 * This is in addition to hasPermission(actor, "members:remove"), which gates
 * whether the actor can touch the members surface at all.
 */
export function canManageMember(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN" && target !== "OWNER") return true;
  return false;
}

/**
 * Can `actor` invite someone with role `targetRole`?
 *   - OWNER can invite OWNER / ADMIN / ACCOUNTANT / VIEWER.
 *   - ADMIN can invite ACCOUNTANT / VIEWER. ADMIN cannot mint another OWNER
 *     and cannot promote to ADMIN — that's the OWNER's call.
 *   - Anyone else cannot invite.
 */
export function canInviteRole(actor: Role, targetRole: Role): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return targetRole === "ACCOUNTANT" || targetRole === "VIEWER";
  return false;
}
