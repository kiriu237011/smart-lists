/**
 * @file playwright.config.ts
 * @description Конфигурация E2E-тестов.
 *
 * E2E проверяют то, чего не видят юниты и интеграционные тесты: связку
 * Server Action → `revalidatePath` → RSC payload → примирение с `useOptimistic`,
 * клиентское состояние в `localStorage` и cookie, порталы и диалоги,
 * перетаскивание, условный рендер по роли и редиректы локализованных маршрутов.
 *
 * Приложение поднимается production-сборкой (`next build && next start`), а не
 * `next dev`: dev компилирует маршруты по первому обращению, из-за чего первые
 * переходы упираются в таймауты, а поведение отличается от боевого.
 *
 * Авторизация: OAuth не выполняется. Тест создаёт строку `Session` в базе и
 * кладёт её токен в cookie (см. `test/e2e/fixtures.ts`).
 */

import { defineConfig, devices } from "@playwright/test";

import { appEnv, E2E_BASE_URL, E2E_PORT } from "./test/e2e/env";

const isCI = Boolean(process.env.CI);
// На Windows завершение Playwright иногда оставляет дочерний `next start` на
// порту 3100. Автоматическое переиспользование такого процесса опасно: он может
// обслуживать предыдущую `.next`-сборку, и тесты будут проверять старый код.
// Внешний сервер разрешается переиспользовать только осознанно.
const reuseExistingServer =
  !isCI && process.env.E2E_REUSE_SERVER === "1";

/**
 * Локальная итерация по тестам не должна каждый раз ждать сборку.
 * `E2E_SKIP_BUILD=1` запускает уже собранное приложение — но собранное из
 * прежнего кода, поэтому по умолчанию сборка выполняется всегда.
 */
const serverCommand =
  process.env.E2E_SKIP_BUILD === "1"
    ? `npx next start -p ${E2E_PORT}`
    : `npx next build && npx next start -p ${E2E_PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.e2e.ts",

  globalSetup: "./test/e2e/global-setup.ts",

  // Тесты изолированы данными (свой пользователь на тест), но делят один
  // production-сервер с DB-пулом max=5. Scoped-транзакции удерживают соединение
  // на всю DB-фазу Action, поэтому оставляем два worker: остальной запас нужен
  // Auth.js, RSC-чтениям и setup/teardown самих тестов.
  fullyParallel: true,
  forbidOnly: isCI,
  // Один retry в CI отсекает редкие сетевые и таймингвые срывы. Локально
  // ретраев нет: падение должно быть видно сразу.
  retries: isCI ? 1 : 0,
  workers: 2,

  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: E2E_BASE_URL,
    // Локаль браузера определяет, куда next-intl редиректит с `/`.
    // Фиксируем en — default locale приложения.
    locale: "en-US",
    timezoneId: "UTC",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: serverCommand,
    url: E2E_BASE_URL,
    reuseExistingServer,
    // Сборка Next на холодном кэше занимает минуты.
    timeout: 300_000,
    env: appEnv,
    stdout: "pipe",
    stderr: "pipe",
  },
});
