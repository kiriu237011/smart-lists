/**
 * @file global-setup.ts
 * @description Однократная подготовка БД перед всем прогоном интеграционных тестов.
 *
 * Ждёт готовности Postgres (контейнер мог только что подняться) и накатывает
 * миграции тем же `prisma migrate deploy`, что и продакшн-деплой, — схема в
 * тестах гарантированно совпадает с боевой.
 */

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/smartlists_test";

/** Пингует БД с ретраями: контейнер может быть ещё не готов к подключению. */
async function waitForDatabase(): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const deadline = Date.now() + 45_000;
  let lastError: unknown;

  try {
    while (Date.now() < deadline) {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  throw new Error(
    `Тестовая БД недоступна по ${DATABASE_URL}. ` +
      `Подними её: npm run test:integration:db. Последняя ошибка: ${String(lastError)}`,
  );
}

/**
 * Страховка: миграции применяются только к заведомо тестовой БД.
 *
 * Prisma CLI читает корневой `.env`, где лежит dev- или боевое подключение.
 * Наш явный `DATABASE_URL` его перекрывает, но одна опечатка не должна вести к
 * `migrate deploy` против чужой базы. Признак тестовой базы — имя, содержащее
 * `test`. Обойти сознательно можно переменной `ALLOW_NON_TEST_DB=1`.
 */
function assertTestDatabase(url: string): void {
  if (process.env.ALLOW_NON_TEST_DB === "1") return;

  const dbName = url.split("/").pop()?.split("?")[0] ?? "";
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Отказ: интеграционные тесты нацелены на «${dbName}», а это не похоже на ` +
        `тестовую базу (в имени нет "test"). Проверь DATABASE_URL. ` +
        `Осознанно разрешить: ALLOW_NON_TEST_DB=1.`,
    );
  }
}

export async function setup(): Promise<void> {
  assertTestDatabase(DATABASE_URL);
  await waitForDatabase();

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL, DIRECT_URL: DATABASE_URL },
  });
}
