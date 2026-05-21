-- Sprint 6A: AI action plans + audit log

CREATE TYPE "AiActionPlanStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'FAILED', 'EXPIRED');

CREATE TABLE "AiActionPlan" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "organizationId" TEXT,
  "status"         "AiActionPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "message"        TEXT NOT NULL,
  "planJson"       JSONB NOT NULL,
  "resultJson"     JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt"    TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  CONSTRAINT "AiActionPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiActionPlan_userId_idx"         ON "AiActionPlan"("userId");
CREATE INDEX "AiActionPlan_organizationId_idx" ON "AiActionPlan"("organizationId");
CREATE INDEX "AiActionPlan_status_idx"         ON "AiActionPlan"("status");

ALTER TABLE "AiActionPlan"
  ADD CONSTRAINT "AiActionPlan_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiAuditLog" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "organizationId" TEXT,
  "actionPlanId"   TEXT,
  "actionType"     TEXT NOT NULL,
  "targetType"     TEXT NOT NULL,
  "targetId"       TEXT NOT NULL,
  "payloadJson"    JSONB NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiAuditLog_userId_idx"         ON "AiAuditLog"("userId");
CREATE INDEX "AiAuditLog_organizationId_idx" ON "AiAuditLog"("organizationId");
CREATE INDEX "AiAuditLog_actionPlanId_idx"   ON "AiAuditLog"("actionPlanId");

ALTER TABLE "AiAuditLog"
  ADD CONSTRAINT "AiAuditLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiAuditLog"
  ADD CONSTRAINT "AiAuditLog_actionPlanId_fkey"
  FOREIGN KEY ("actionPlanId") REFERENCES "AiActionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
