import "dotenv/config";

import { defineConfig } from "prisma/config";

/**
 * Prisma CLI выполняет миграции через прямое подключение из DIRECT_URL.
 * Обычный `prisma generate` не подключается к БД и должен работать без этого
 * секрета: production build больше не получает владельческий URL. Команды,
 * которым нужна БД, сами завершатся ошибкой при пустом URL; release workflow
 * дополнительно проверяет DIRECT_URL и точный host до запуска Prisma.
 * Runtime приложения использует пулер из DATABASE_URL через PrismaPg.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? "",
  },
});
