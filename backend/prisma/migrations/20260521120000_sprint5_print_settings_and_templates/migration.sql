-- Sprint 5: реквизиты, печатные формы, шаблоны договоров

-- Organization: дополнительные реквизиты + настройки печатных форм
ALTER TABLE "Organization"
  ADD COLUMN "accountantPosition" TEXT,
  ADD COLUMN "basedOn"            TEXT DEFAULT 'Устава',
  ADD COLUMN "website"            TEXT,
  ADD COLUMN "postalAddress"      TEXT,
  ADD COLUMN "printShowLogo"                BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "printShowStamp"               BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "printShowSignature"           BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "printShowAccountantSignature" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "printShowBankDetails"         BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "printShowQrCode"              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "printDefaultVatText"          TEXT,
  ADD COLUMN "printDefaultPaymentTerms"     TEXT,
  ADD COLUMN "printDefaultFooterText"       TEXT,
  ADD COLUMN "printInvoiceNote"             TEXT,
  ADD COLUMN "printActNote"                 TEXT,
  ADD COLUMN "printUpdNote"                 TEXT,
  ADD COLUMN "printWaybillNote"             TEXT,
  ADD COLUMN "printReconciliationNote"      TEXT;

-- ContractTemplate
CREATE TABLE "ContractTemplate" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "organizationId" TEXT,
  "name"           TEXT NOT NULL,
  "description"    TEXT,
  "content"        TEXT NOT NULL,
  "variables"      JSONB NOT NULL DEFAULT '[]',
  "isDefault"      BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractTemplate_userId_idx"         ON "ContractTemplate"("userId");
CREATE INDEX "ContractTemplate_organizationId_idx" ON "ContractTemplate"("organizationId");

ALTER TABLE "ContractTemplate"
  ADD CONSTRAINT "ContractTemplate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Contract.templateId
ALTER TABLE "Contract" ADD COLUMN "templateId" TEXT;
CREATE INDEX "Contract_templateId_idx" ON "Contract"("templateId");
ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
