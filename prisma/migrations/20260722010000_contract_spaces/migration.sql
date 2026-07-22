-- Contract-миграция пространств.
-- Запускается только после выкладки runtime, который читает и пишет ListShare
-- и больше не обращается к implicit M2M-таблице "_Shared".

-- Финальная страховка для пользователей, появившихся во время expand-периода.
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
    CONCAT('space_default_', users."id"),
    NULL,
    NULL,
    true,
    users."id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User" AS users
WHERE NOT EXISTS (
    SELECT 1
    FROM "Space" AS spaces
    WHERE spaces."userId" = users."id"
      AND spaces."isDefault" = true
)
ON CONFLICT ("id") DO NOTHING;

-- Финальный backfill nullable-полей перед включением NOT NULL.
UPDATE "List" AS lists
SET "spaceId" = spaces."id"
FROM "Space" AS spaces
WHERE lists."spaceId" IS NULL
  AND spaces."userId" = lists."ownerId"
  AND spaces."isDefault" = true;

UPDATE "ListGroup" AS groups
SET "spaceId" = spaces."id"
FROM "Space" AS spaces
WHERE groups."spaceId" IS NULL
  AND spaces."userId" = groups."userId"
  AND spaces."isDefault" = true;

-- Повторяем перенос legacy-share на случай записи старым инстансом между
-- expand-миграцией и выкладкой code-cutover.
INSERT INTO "ListShare" ("listId", "userId", "spaceId", "role", "createdAt")
SELECT
    shared."A",
    shared."B",
    spaces."id",
    'EDITOR'::"ListShareRole",
    CURRENT_TIMESTAMP
FROM "_Shared" AS shared
JOIN "Space" AS spaces
  ON spaces."userId" = shared."B"
 AND spaces."isDefault" = true
ON CONFLICT ("listId", "userId") DO NOTHING;

-- Если backfill не смог найти пространство, PostgreSQL остановит миграцию
-- здесь и сохранит старую таблицу благодаря транзакционности миграции.
ALTER TABLE "List"
    ALTER COLUMN "spaceId" SET NOT NULL;

ALTER TABLE "ListGroup"
    ALTER COLUMN "spaceId" SET NOT NULL;

-- Runtime этапа 1/2 уже не читает и не пишет эту таблицу.
DROP TABLE "_Shared";
