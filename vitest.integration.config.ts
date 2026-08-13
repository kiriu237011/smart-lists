/**
 * @file vitest.integration.config.ts
 * @description Конфигурация интеграционных тестов Server Actions.
 *
 * В отличие от юнит-тестов (`vitest.config.ts`), эти тесты работают против
 * настоящего PostgreSQL: они проверяют права доступа, привязку к пространству,
 * каскады и concurrency — то, что не воспроизвести без БД. Внешние сервисы
 * (Auth.js, Pusher, S3, ревалидация Next) замоканы в `test/integration/setup.ts`.
 *
 * Отделены от юнитов намеренно: юниты остаются быстрыми и без зависимостей,
 * а интеграционные требуют поднятого контейнера и запускаются своей командой.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(
  new URL("./test/stubs/server-only.ts", import.meta.url),
);

/** Тестовая БД по умолчанию — контейнер из docker-compose.test.yml (порт 5433). */
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5433/smartlists_test";
const TEST_ADMIN_DATABASE_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DIRECT_URL ??
  TEST_DATABASE_URL;

// Actions используют runtime URL. Миграции и очистка fixtures могут получить
// отдельный admin URL, чтобы restricted runtime не требовал DDL/TRUNCATE.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.DIRECT_URL = TEST_ADMIN_DATABASE_URL;
process.env.TEST_ADMIN_DATABASE_URL = TEST_ADMIN_DATABASE_URL;

// Actions логируют ошибки через pino; в тестах ожидаемые ошибки (отказ доступа,
// конфликт версий) — это норма, а не повод засорять вывод. Глушим логгер.
process.env.LOG_LEVEL = "silent";

// Заведомо фиктивные S3-переменные. `@/lib/s3` конструирует S3Client прямо на
// импорте, и без региона AWS SDK бросает «Region is missing» ещё до всякого
// мока (локально это маскировал корневой .env, в CI его нет). Значения
// перекрываются жёстко: даже если в .env лежат боевые креды, тест их не
// увидит — сетевые вызовы S3 всё равно замоканы в setup.ts.
process.env.S3_BUCKET_NAME = "test-bucket";
process.env.S3_REGION = "us-east-1";
process.env.S3_ACCESS_KEY_ID = "test-access-key";
process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${srcPath}/$1` },
      // Server Actions импортируют server-only модули (`@/lib/spaces` и др.);
      // вне RSC-контекста настоящий `server-only` бросает ошибку на импорте.
      { find: /^server-only$/, replacement: serverOnlyStub },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts", "test/**/*.int.test.ts"],
    globalSetup: ["./test/integration/global-setup.ts"],
    setupFiles: ["./test/integration/setup.ts"],
    // Тесты делят одну БД и чистят её в beforeEach, поэтому параллельные файлы
    // затирали бы данные друг друга. Один воркер — цена изоляции без отдельной
    // БД на файл; набор небольшой, прогон остаётся быстрым.
    fileParallelism: false,
    // Поднять контейнер и накатить миграции при первом запуске бывает дольше
    // дефолтных 5 секунд.
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
