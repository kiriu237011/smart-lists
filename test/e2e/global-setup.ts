/**
 * @file global-setup.ts
 * @description Однократная подготовка базы перед всем E2E-прогоном.
 *
 * Ждёт готовности Postgres (контейнер мог только что подняться), накатывает
 * миграции тем же `prisma migrate deploy`, что и продакшн-деплой, и очищает
 * таблицы.
 *
 * Очистка выполняется здесь, а не между тестами: базу читает и пишет
 * запущенное приложение, тесты идут параллельными воркерами, и TRUNCATE
 * посреди прогона снёс бы данные соседнего теста. Изоляция достигается иначе —
 * каждый тест работает под собственным пользователем со своим пространством
 * (см. `factories.ts`).
 */

import { execSync } from "node:child_process";

import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/prisma-client";

import { E2E_DATABASE_URL } from "./env";

/**
 * Страховка: миграции и очистка применяются только к заведомо тестовой базе.
 *
 * prisma.config.ts читает DIRECT_URL из окружения или корневого `.env`.
 * Setup передаёт адрес E2E-БД явно, но одна опечатка не должна вести к
 * `migrate deploy` и `TRUNCATE` против чужой базы. Признак тестовой базы —
 * имя, содержащее `test`. Обойти сознательно можно `ALLOW_NON_TEST_DB=1`.
 */
function assertTestDatabase(url: string): void {
  if (process.env.ALLOW_NON_TEST_DB === "1") return;

  const dbName = url.split("/").pop()?.split("?")[0] ?? "";
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Отказ: E2E нацелены на «${dbName}», а это не похоже на тестовую базу ` +
        `(в имени нет "test"). Проверь E2E_DATABASE_URL. ` +
        `Осознанно разрешить: ALLOW_NON_TEST_DB=1.`,
    );
  }
}

/** Пингует базу с ретраями: контейнер может быть ещё не готов к подключению. */
async function waitForDatabase(prisma: PrismaClient): Promise<void> {
  const deadline = Date.now() + 45_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error(
    `База E2E недоступна по ${E2E_DATABASE_URL}. ` +
      `Подними её: npm run test:e2e:db. Последняя ошибка: ${String(lastError)}`,
  );
}

/** Таблицы в порядке, безопасном для TRUNCATE ... CASCADE. */
const TABLES = [
  "Attachment",
  "Item",
  "ListShare",
  "ListGroup",
  "List",
  "Space",
  "AiInsightUsage",
  "Session",
  "Account",
  "VerificationToken",
  "AllowedEmail",
  "AppSetting",
  "User",
];

export default async function globalSetup(): Promise<void> {
  assertTestDatabase(E2E_DATABASE_URL);

  const prisma = createPrismaClient(E2E_DATABASE_URL);
  try {
    await waitForDatabase(prisma);

    execSync("npx prisma migrate deploy", {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: E2E_DATABASE_URL,
        DIRECT_URL: E2E_DATABASE_URL,
      },
    });

    await prisma.$executeRawUnsafe(
      `TRUNCATE ${TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  } finally {
    await prisma.$disconnect();
  }
}
