-- Налоговая реформа 2026 (ФЗ от 28.11.2025 № 425-ФЗ):
-- 1. Добавлен enum VatMode (EXEMPT / USN_5 / USN_7 / GENERAL)
-- 2. Organization.vatPayer (Boolean) заменён на vatMode (VatMode)
-- 3. Добавлено значение AUSN в enum TaxSystem
-- 4. Ставка НДС по умолчанию изменена с 20.00 на 22.00 во всех документах и DocumentItem

-- 1. AUSN в TaxSystem
ALTER TYPE "TaxSystem" ADD VALUE IF NOT EXISTS 'AUSN' AFTER 'USN_INCOME';

-- 2. Новый enum VatMode
CREATE TYPE "VatMode" AS ENUM ('EXEMPT', 'USN_5', 'USN_7', 'GENERAL');

-- 3. Organization: добавляем vatMode с конверсией из vatPayer, потом дропаем старую колонку
ALTER TABLE "Organization" ADD COLUMN "vatMode" "VatMode" NOT NULL DEFAULT 'GENERAL';
UPDATE "Organization" SET "vatMode" = CASE WHEN "vatPayer" = false THEN 'EXEMPT'::"VatMode" ELSE 'GENERAL'::"VatMode" END;
ALTER TABLE "Organization" DROP COLUMN "vatPayer";

-- 4. Поменять дефолты vatRate в декларациях колонок (не трогаем существующие значения — это исторические документы)
ALTER TABLE "Nomenclature" ALTER COLUMN "vatRate" SET DEFAULT 22.00;
ALTER TABLE "Invoice" ALTER COLUMN "vatRate" SET DEFAULT 22.00;
ALTER TABLE "Act" ALTER COLUMN "vatRate" SET DEFAULT 22.00;
ALTER TABLE "UpdDocument" ALTER COLUMN "vatRate" SET DEFAULT 22.00;
ALTER TABLE "Waybill" ALTER COLUMN "vatRate" SET DEFAULT 22.00;
ALTER TABLE "DocumentItem" ALTER COLUMN "vatRate" SET DEFAULT 22.00;
