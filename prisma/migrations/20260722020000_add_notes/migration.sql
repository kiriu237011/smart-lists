-- Заметки списка и его записей хранятся непосредственно на родительских сущностях.
-- noteVersion обеспечивает optimistic concurrency control при совместном редактировании.
ALTER TABLE "List"
ADD COLUMN "note" TEXT,
ADD COLUMN "noteVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "noteUpdatedAt" TIMESTAMP(3);

ALTER TABLE "Item"
ADD COLUMN "note" TEXT,
ADD COLUMN "noteVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "noteUpdatedAt" TIMESTAMP(3);
