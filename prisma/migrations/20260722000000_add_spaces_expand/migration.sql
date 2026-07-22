-- Expand-миграция пространств.
-- Старые sharedWith и nullable spaceId намеренно сохраняются до contract-релиза:
-- предыдущая версия приложения остаётся совместимой во время rolling deployment.

-- CreateEnum
CREATE TYPE "ListShareRole" AS ENUM ('EDITOR');

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "normalizedName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- AddColumns
ALTER TABLE "List" ADD COLUMN "spaceId" TEXT;
ALTER TABLE "ListGroup" ADD COLUMN "spaceId" TEXT;

-- CreateTable
CREATE TABLE "ListShare" (
    "listId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "role" "ListShareRole" NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListShare_pkey" PRIMARY KEY ("listId", "userId")
);

-- CreateIndexes
CREATE UNIQUE INDEX "Space_userId_normalizedName_key" ON "Space"("userId", "normalizedName");
CREATE UNIQUE INDEX "Space_id_userId_key" ON "Space"("id", "userId");
CREATE INDEX "Space_userId_isDefault_idx" ON "Space"("userId", "isDefault");
CREATE UNIQUE INDEX "Space_one_default_per_user_idx" ON "Space"("userId") WHERE "isDefault" = true;
CREATE INDEX "List_spaceId_idx" ON "List"("spaceId");
CREATE INDEX "ListGroup_spaceId_idx" ON "ListGroup"("spaceId");
CREATE INDEX "ListShare_userId_spaceId_idx" ON "ListShare"("userId", "spaceId");
CREATE INDEX "ListShare_spaceId_idx" ON "ListShare"("spaceId");

-- SeedDefaultSpaces
INSERT INTO "Space" (
    "id",
    "name",
    "normalizedName",
    "isDefault",
    "userId",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('space_default_', "id"),
    NULL,
    NULL,
    true,
    "id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User";

-- BackfillOwnedContent
UPDATE "List"
SET "spaceId" = CONCAT('space_default_', "ownerId")
WHERE "spaceId" IS NULL;

UPDATE "ListGroup"
SET "spaceId" = CONCAT('space_default_', "userId")
WHERE "spaceId" IS NULL;

-- BackfillExplicitShares
INSERT INTO "ListShare" ("listId", "userId", "spaceId", "role", "createdAt")
SELECT
    shared."A",
    shared."B",
    CONCAT('space_default_', shared."B"),
    'EDITOR'::"ListShareRole",
    CURRENT_TIMESTAMP
FROM "_Shared" AS shared
ON CONFLICT ("listId", "userId") DO NOTHING;

-- AddForeignKeys
ALTER TABLE "Space"
    ADD CONSTRAINT "Space_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "List"
    ADD CONSTRAINT "List_spaceId_ownerId_fkey"
    FOREIGN KEY ("spaceId", "ownerId") REFERENCES "Space"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListGroup"
    ADD CONSTRAINT "ListGroup_spaceId_userId_fkey"
    FOREIGN KEY ("spaceId", "userId") REFERENCES "Space"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListShare"
    ADD CONSTRAINT "ListShare_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "List"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListShare"
    ADD CONSTRAINT "ListShare_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ListShare"
    ADD CONSTRAINT "ListShare_spaceId_userId_fkey"
    FOREIGN KEY ("spaceId", "userId") REFERENCES "Space"("id", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE;
