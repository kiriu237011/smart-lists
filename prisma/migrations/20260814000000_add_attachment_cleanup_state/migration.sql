-- Служебное состояние отделяет освобождение квоты от best-effort удаления S3.
-- Новое значение enum добавляется отдельной миграцией: PostgreSQL запрещает
-- безопасно использовать только что добавленное значение в той же транзакции.
ALTER TYPE "AttachmentStatus" ADD VALUE 'CLEANUP_PENDING';

ALTER TABLE "Attachment"
ADD COLUMN "cleanupToken" UUID,
ADD COLUMN "cleanupRequestedById" TEXT,
ADD COLUMN "cleanupStartedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Attachment_cleanupToken_key"
ON "Attachment"("cleanupToken");

CREATE INDEX "Attachment_cleanupRequestedById_status_idx"
ON "Attachment"("cleanupRequestedById", "status");
