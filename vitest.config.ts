/**
 * @file vitest.config.ts
 * @description Конфигурация юнит-тестов.
 *
 * Область: чистые функции и Zod-схемы из `src/lib`. Тесты не поднимают
 * Next.js, не ходят в PostgreSQL, S3 и Pusher — прогон не требует ни секретов,
 * ни сети, поэтому его можно безопасно выполнять и локально, и в CI.
 */

import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const srcPath = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(
  new URL("./test/stubs/server-only.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [
      // Тот же алиас, что в tsconfig: тесты импортируют код как приложение.
      { find: /^@\/(.*)$/, replacement: `${srcPath}/$1` },
      // Вне RSC-контекста настоящий `server-only` бросает ошибку на импорте.
      { find: /^server-only$/, replacement: serverOnlyStub },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Интеграционные тесты (`*.int.test.ts`) требуют БД и своего конфига
    // (`vitest.integration.config.ts`); паттерн include их иначе захватывает,
    // потому что они тоже оканчиваются на `.test.ts`.
    exclude: [...configDefaults.exclude, "**/*.int.test.ts"],
  },
});
