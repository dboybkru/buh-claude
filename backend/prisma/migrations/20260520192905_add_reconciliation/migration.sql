-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('DRAFT', 'SENT', 'AGREED', 'DISAGREED');

-- CreateTable
CREATE TABLE "ReconciliationAct" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "openingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalDebit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "closingBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationAct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationAct_userId_idx" ON "ReconciliationAct"("userId");

-- CreateIndex
CREATE INDEX "ReconciliationAct_counterpartyId_idx" ON "ReconciliationAct"("counterpartyId");

-- CreateIndex
CREATE INDEX "ReconciliationAct_periodTo_idx" ON "ReconciliationAct"("periodTo");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationAct_userId_number_key" ON "ReconciliationAct"("userId", "number");

-- AddForeignKey
ALTER TABLE "ReconciliationAct" ADD CONSTRAINT "ReconciliationAct_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationAct" ADD CONSTRAINT "ReconciliationAct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationAct" ADD CONSTRAINT "ReconciliationAct_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
