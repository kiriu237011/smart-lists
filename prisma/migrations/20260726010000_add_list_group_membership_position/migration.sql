-- Порядок списков становится персональным для каждой группы.
-- Таблица уже содержит все связи implicit many-to-many; добавляем к ним
-- позицию и сохраняем прежний видимый порядок списков (новые сверху).

ALTER TABLE "_ListGroupMembers" ADD COLUMN "position" DOUBLE PRECISION;

UPDATE "_ListGroupMembers" AS membership
SET "position" = numbered."rn"
FROM (
  SELECT
    membership."A",
    membership."B",
    ROW_NUMBER() OVER (
      PARTITION BY membership."B"
      ORDER BY list."createdAt" DESC, list."id" ASC
    ) AS "rn"
  FROM "_ListGroupMembers" AS membership
  JOIN "List" AS list ON list."id" = membership."A"
) AS numbered
WHERE membership."A" = numbered."A"
  AND membership."B" = numbered."B";

ALTER TABLE "_ListGroupMembers" ALTER COLUMN "position" SET NOT NULL;

CREATE INDEX "_ListGroupMembers_groupId_position_idx"
ON "_ListGroupMembers"("B", "position");
