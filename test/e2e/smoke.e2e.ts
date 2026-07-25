/**
 * @file smoke.e2e.ts
 * @description Проверка самой обвязки E2E, а не продуктового поведения.
 *
 * Падение здесь означает сломанное окружение: не поднялась база, не накатились
 * миграции, не собралось приложение или не сработала подстановка сессии.
 * Держим отдельно от продуктовых спек, чтобы такую поломку было видно сразу.
 */

import { anonymousTest, expect, test } from "./fixtures";

anonymousTest("без сессии корень ведёт на экран входа", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("сессия из базы открывает пространство пользователя", async ({ page, user }) => {
  await page.goto("/");

  await expect(page).toHaveURL(`/en/spaces/${user.defaultSpaceId}`);
  await expect(page.getByText(user.email)).toBeVisible();
});
