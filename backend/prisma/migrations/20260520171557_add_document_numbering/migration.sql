-- CreateTable
CREATE TABLE "DocumentNumbering" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "docType" "DocType" NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "prefix" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentNumbering_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentNumbering_userId_idx" ON "DocumentNumbering"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentNumbering_userId_organizationId_docType_year_key" ON "DocumentNumbering"("userId", "organizationId", "docType", "year");

-- AddForeignKey
ALTER TABLE "DocumentNumbering" ADD CONSTRAINT "DocumentNumbering_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
