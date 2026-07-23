-- Порядок записей внутри списка становится явным полем вместо неявной
-- сортировки по createdAt. Тип дробный: перемещение записи вычисляет середину
-- между позициями соседей и обновляет одну строку, а не перенумеровывает список.
--
-- Колонка добавляется в три шага, чтобы существующие строки не потеряли порядок:
-- nullable -> backfill в текущем видимом порядке -> NOT NULL.

ALTER TABLE "Item" ADD COLUMN "position" DOUBLE PRECISION;

-- Backfill повторяет ровно ту сортировку, по которой записи показывались до сих
-- пор (createdAt ASC), с добавлением id как тайбрейка для строк, созданных в одну
-- миллисекунду. Видимый порядок после миграции не меняется.
UPDATE "Item" AS i
SET "position" = numbered."rn"
FROM (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "listId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "rn"
  FROM "Item"
) AS numbered
WHERE i."id" = numbered."id";

ALTER TABLE "Item" ALTER COLUMN "position" SET NOT NULL;

-- Основная выборка — «записи списка в порядке отображения».
CREATE INDEX "Item_listId_position_idx" ON "Item"("listId", "position");

-- Отдельный индекс по listId избыточен: составной индекс выше начинается с
-- listId, поэтому Postgres использует его и для запросов по одному этому полю
-- (в том числе при каскадном удалении списка).
DROP INDEX "Item_listId_idx";
