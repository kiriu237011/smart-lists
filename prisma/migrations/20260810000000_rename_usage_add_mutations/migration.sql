-- Переименование, а не пересоздание: в таблице лежат живые счётчики квоты за
-- сегодняшний день, и DROP + CREATE сбросил бы их всем, кто уже потратил часть
-- дневного лимита. Prisma сама различить переименование и пару «удалили/создали»
-- не может, поэтому миграция написана руками.
--
-- Порядок важен: сначала таблица, затем ограничения и индексы, иначе имена
-- ссылались бы на несуществующее отношение.

-- Таблица перестала быть только про AI: к счётчику инсайтов добавляется
-- счётчик мутаций, и прежнее имя вводило бы в заблуждение.
ALTER TABLE "AiInsightUsage" RENAME TO "UserDailyUsage";

ALTER TABLE "UserDailyUsage" RENAME CONSTRAINT "AiInsightUsage_pkey" TO "UserDailyUsage_pkey";
ALTER TABLE "UserDailyUsage" RENAME CONSTRAINT "AiInsightUsage_userId_fkey" TO "UserDailyUsage_userId_fkey";
ALTER INDEX "AiInsightUsage_userId_date_key" RENAME TO "UserDailyUsage_userId_date_key";

-- `count` без уточнения теперь неоднозначен: счётчиков стало два.
ALTER TABLE "UserDailyUsage" RENAME COLUMN "count" TO "insights";

-- Существующим строкам проставляется 0: у прошедших дней счётчика мутаций не
-- было, и любое другое значение было бы выдумкой.
ALTER TABLE "UserDailyUsage" ADD COLUMN "mutations" INTEGER NOT NULL DEFAULT 0;
