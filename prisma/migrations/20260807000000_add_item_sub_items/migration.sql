-- Подпункты: запись получает необязательную ссылку на родительскую запись.
-- Ровно один уровень вложенности; глубину проверяет Server Action, потому что
-- составной внешний ключ её выразить не может.
--
-- Существующие строки получают parentId = NULL и остаются пунктами верхнего
-- уровня, поэтому backfill не нужен и порядок записей не меняется.

ALTER TABLE "Item" ADD COLUMN "parentId" TEXT;

-- Цель составной связи: ссылка на пункт всегда несёт и его listId.
CREATE UNIQUE INDEX "Item_id_listId_key" ON "Item"("id", "listId");

-- Ключ составной, по паре (parentId, listId), а не по одному parentId. Это
-- даёт два свойства без единой строки кода:
--
--   1. Подпункт не может лежать в другом списке, чем его родитель: пара просто
--      не найдёт цели.
--   2. ON UPDATE CASCADE переносит подпункты за родителем при смене listId,
--      поэтому перенос пункта в другой список остаётся ОДНОЙ записью в БД.
--
-- Семантика MATCH SIMPLE здесь и нужна: при parentId IS NULL ключ не
-- проверяется вовсе — это пункт верхнего уровня.
ALTER TABLE "Item"
  ADD CONSTRAINT "Item_parentId_listId_fkey"
  FOREIGN KEY ("parentId", "listId") REFERENCES "Item"("id", "listId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Позиция теперь значима внутри группы (listId, parentId): у пунктов верхнего
-- уровня сравниваются пункты списка, у подпунктов — подпункты одного родителя.
-- Индекс повторяет эту группировку и обслуживает обе выборки; префикс listId
-- продолжает работать для запросов по одному списку и для каскадов.
CREATE INDEX "Item_listId_parentId_position_idx" ON "Item"("listId", "parentId", "position");

DROP INDEX "Item_listId_position_idx";
