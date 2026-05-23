-- CreateEnum
CREATE TYPE "IntegrationCategory" AS ENUM ('DADATA', 'AI', 'SMTP', 'APP');

-- CreateEnum
CREATE TYPE "SystemAuditAction" AS ENUM ('SYSTEM_SETTING_UPDATED', 'SYSTEM_SETTING_TESTED', 'SECRET_ROTATED');

-- CreateTable
CREATE TABLE "IntegrationSetting" (
    "id" TEXT NOT NULL,
    "category" "IntegrationCategory" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "configJson" JSONB NOT NULL DEFAULT '{}',
    "secretsCiphertext" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemAuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" "SystemAuditAction" NOT NULL,
    "category" "IntegrationCategory",
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationSetting_category_key" ON "IntegrationSetting"("category");

-- CreateIndex
CREATE INDEX "IntegrationSetting_category_idx" ON "IntegrationSetting"("category");

-- CreateIndex
CREATE INDEX "SystemAuditLog_actorUserId_idx" ON "SystemAuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "SystemAuditLog_category_idx" ON "SystemAuditLog"("category");

-- CreateIndex
CREATE INDEX "SystemAuditLog_createdAt_idx" ON "SystemAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "IntegrationSetting" ADD CONSTRAINT "IntegrationSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemAuditLog" ADD CONSTRAINT "SystemAuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
