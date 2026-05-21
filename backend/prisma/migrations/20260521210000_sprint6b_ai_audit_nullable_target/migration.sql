-- Sprint 6B: targetId nullable для информационных AI-действий (analyze_debt),
-- которые не создают бизнес-сущности.

ALTER TABLE "AiAuditLog" ALTER COLUMN "targetId" DROP NOT NULL;
