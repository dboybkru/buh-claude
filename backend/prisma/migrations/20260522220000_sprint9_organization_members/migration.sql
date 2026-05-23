-- Sprint 9: Roles & permissions — organization membership model.
-- Adds OrganizationMember linking users to organizations with a role and
-- status. Backfills an OWNER membership for every existing organization so
-- legacy data keeps working: the historical Organization.userId still tells
-- us who the original owner is, and that user becomes the OWNER.
-- NOTE: schema column `userId` on Organization is intentionally kept as a
-- legacy/audit field. New code goes through OrganizationMember.

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'ACCOUNTANT', 'VIEWER');

-- CreateEnum
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "role" "OrganizationRole" NOT NULL DEFAULT 'VIEWER',
    "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedById" TEXT,
    "invitedEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE INDEX "OrganizationMember_invitedEmail_idx" ON "OrganizationMember"("invitedEmail");

-- AddForeignKey
ALTER TABLE "OrganizationMember"
    ADD CONSTRAINT "OrganizationMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationMember"
    ADD CONSTRAINT "OrganizationMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationMember"
    ADD CONSTRAINT "OrganizationMember_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing organization gets exactly one OWNER membership
-- for its historical userId. updatedAt is set explicitly because the column
-- is NOT NULL and Postgres doesn't auto-populate it on plain INSERT.
INSERT INTO "OrganizationMember" ("id", "organizationId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    o."id",
    o."userId",
    'OWNER'::"OrganizationRole",
    'ACTIVE'::"OrganizationMemberStatus",
    o."createdAt",
    NOW()
FROM "Organization" o
WHERE NOT EXISTS (
    SELECT 1 FROM "OrganizationMember" m
    WHERE m."organizationId" = o."id" AND m."userId" = o."userId"
);
