import "dotenv/config";

import { defineConfig, env } from "prisma/config";

/**
 * Prisma CLI должен выполнять миграции через прямое подключение к PostgreSQL.
 * Runtime приложения продолжает использовать пулер из DATABASE_URL через PrismaPg.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
