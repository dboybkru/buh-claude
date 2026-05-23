import { describe, it, expect } from "vitest";
import {
  hasPermission,
  canInviteRole,
  canManageMember,
  roleAtLeast,
} from "./permissions.js";

describe("permissions matrix", () => {
  it("OWNER > ADMIN > ACCOUNTANT > VIEWER", () => {
    expect(roleAtLeast("OWNER", "ADMIN")).toBe(true);
    expect(roleAtLeast("ADMIN", "ACCOUNTANT")).toBe(true);
    expect(roleAtLeast("ACCOUNTANT", "VIEWER")).toBe(true);
    expect(roleAtLeast("VIEWER", "ACCOUNTANT")).toBe(false);
    expect(roleAtLeast("ACCOUNTANT", "ADMIN")).toBe(false);
    expect(roleAtLeast("ADMIN", "OWNER")).toBe(false);
  });

  it("VIEWER can only read", () => {
    expect(hasPermission("VIEWER", "data:read")).toBe(true);
    expect(hasPermission("VIEWER", "org:read")).toBe(true);
    expect(hasPermission("VIEWER", "files:read")).toBe(true);
    expect(hasPermission("VIEWER", "data:write")).toBe(false);
    expect(hasPermission("VIEWER", "payments:write")).toBe(false);
    expect(hasPermission("VIEWER", "bank:import")).toBe(false);
    expect(hasPermission("VIEWER", "ai:confirm")).toBe(false);
    expect(hasPermission("VIEWER", "files:upload")).toBe(false);
    expect(hasPermission("VIEWER", "members:invite")).toBe(false);
  });

  it("ACCOUNTANT can write data and payments, not settings or files", () => {
    expect(hasPermission("ACCOUNTANT", "data:write")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "payments:write")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "bank:import")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "ai:chat")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "ai:confirm")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "members:read")).toBe(true);
    expect(hasPermission("ACCOUNTANT", "org:update")).toBe(false);
    expect(hasPermission("ACCOUNTANT", "members:invite")).toBe(false);
    expect(hasPermission("ACCOUNTANT", "files:upload")).toBe(false);
    expect(hasPermission("ACCOUNTANT", "ai:settings")).toBe(false);
    expect(hasPermission("ACCOUNTANT", "print:settings")).toBe(false);
  });

  it("ADMIN can almost everything except org:delete", () => {
    expect(hasPermission("ADMIN", "members:invite")).toBe(true);
    expect(hasPermission("ADMIN", "members:remove")).toBe(true);
    expect(hasPermission("ADMIN", "files:upload")).toBe(true);
    expect(hasPermission("ADMIN", "ai:settings")).toBe(true);
    expect(hasPermission("ADMIN", "print:settings")).toBe(true);
    expect(hasPermission("ADMIN", "org:delete")).toBe(false);
    expect(hasPermission("ADMIN", "org:update")).toBe(false);
  });

  it("OWNER has everything", () => {
    expect(hasPermission("OWNER", "org:delete")).toBe(true);
    expect(hasPermission("OWNER", "org:update")).toBe(true);
    expect(hasPermission("OWNER", "ai:settings")).toBe(true);
    expect(hasPermission("OWNER", "files:delete")).toBe(true);
    expect(hasPermission("OWNER", "members:invite")).toBe(true);
  });
});

describe("canInviteRole", () => {
  it("OWNER can invite any role", () => {
    expect(canInviteRole("OWNER", "OWNER")).toBe(true);
    expect(canInviteRole("OWNER", "ADMIN")).toBe(true);
    expect(canInviteRole("OWNER", "ACCOUNTANT")).toBe(true);
    expect(canInviteRole("OWNER", "VIEWER")).toBe(true);
  });
  it("ADMIN can invite ACCOUNTANT / VIEWER only", () => {
    expect(canInviteRole("ADMIN", "OWNER")).toBe(false);
    expect(canInviteRole("ADMIN", "ADMIN")).toBe(false);
    expect(canInviteRole("ADMIN", "ACCOUNTANT")).toBe(true);
    expect(canInviteRole("ADMIN", "VIEWER")).toBe(true);
  });
  it("ACCOUNTANT / VIEWER cannot invite", () => {
    expect(canInviteRole("ACCOUNTANT", "VIEWER")).toBe(false);
    expect(canInviteRole("VIEWER", "VIEWER")).toBe(false);
  });
});

describe("canManageMember", () => {
  it("OWNER can manage anyone", () => {
    expect(canManageMember("OWNER", "OWNER")).toBe(true);
    expect(canManageMember("OWNER", "ADMIN")).toBe(true);
    expect(canManageMember("OWNER", "ACCOUNTANT")).toBe(true);
    expect(canManageMember("OWNER", "VIEWER")).toBe(true);
  });
  it("ADMIN cannot manage OWNER", () => {
    expect(canManageMember("ADMIN", "OWNER")).toBe(false);
    expect(canManageMember("ADMIN", "ADMIN")).toBe(true);
    expect(canManageMember("ADMIN", "ACCOUNTANT")).toBe(true);
    expect(canManageMember("ADMIN", "VIEWER")).toBe(true);
  });
  it("ACCOUNTANT / VIEWER cannot manage members", () => {
    expect(canManageMember("ACCOUNTANT", "VIEWER")).toBe(false);
    expect(canManageMember("VIEWER", "VIEWER")).toBe(false);
  });
});
