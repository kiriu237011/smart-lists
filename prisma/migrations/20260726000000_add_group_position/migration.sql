-- Порядок пользовательских групп внутри пространства становится явным.
-- Существующий видимый порядок сохраняется: сначала дата создания, затем id
-- как детерминированный тайбрейк.

ALTER TABLE "ListGroup" ADD COLUMN "position" DOUBLE PRECISION;

UPDATE "ListGroup" AS g
SET "position" = numbered."rn"
FROM (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "spaceId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS "rn"
  FROM "ListGroup"
) AS numbered
WHERE g."id" = numbered."id";

ALTER TABLE "ListGroup" ALTER COLUMN "position" SET NOT NULL;

CREATE INDEX "ListGroup_userId_spaceId_position_idx"
ON "ListGroup"("userId", "spaceId", "position");
