/**
 * @file guest.e2e.ts
 * @description Гостевой режим: данные живут в браузере, а не в базе.
 *
 * Проверить это можно только в браузере: на сервере гостя нет — ни строки
 * пользователя, ни списков. Подтверждение, что запись легла именно в
 * localStorage, а не в БД, тоже часть проверки.
 *
 * Файл выполняется последовательно: гостевой вход включается глобальной
 * настройкой `AppSetting`, одной на всю базу. Параллельные тесты, меняющие её,
 * мешали бы друг другу.
 */

import { anonymousTest as test, expect } from "./fixtures";
import { setGuestMode } from "./factories";
import { addItem, createList, onlyListCard, visible } from "./helpers";

test.describe.configure({ mode: "serial" });

/** Входит гостем с экрана входа. */
async function enterGuest(page: Parameters<typeof createList>[0]): Promise<void> {
  await page.goto("/en");
  await visible(page, "sign-in-guest").click();
  await expect(visible(page, "guest-home")).toBeVisible();
}

test.beforeEach(async ({ db }) => {
  await setGuestMode(db, true);
});

test("гость работает со списками, и они переживают перезагрузку", async ({
  page,
  db,
}) => {
  await enterGuest(page);

  await createList(page, "Гостевой список");
  await addItem(onlyListCard(page), "Гостевое молоко");

  await page.reload();
  await expect(onlyListCard(page).getByTestId("list-title")).toHaveText(
    "Гостевой список",
  );
  await expect(onlyListCard(page).getByTestId("item-name")).toHaveText([
    "Гостевое молоко",
  ]);

  // Ничего из этого на сервер не попало. Считаем по названиям, а не по всей
  // таблице: параллельно идут тесты других пользователей.
  expect(await db.list.count({ where: { title: "Гостевой список" } })).toBe(0);
  expect(await db.item.count({ where: { name: "Гостевое молоко" } })).toBe(0);
});

test("гостю недоступны шаринг, вложения и AI", async ({ page }) => {
  await enterGuest(page);
  await createList(page, "Только локально");

  const card = onlyListCard(page);
  await expect(card.getByTestId("share-toggle")).toHaveCount(0);
  // Панели вложений и инсайтов у гостя не рендерятся вовсе: обе требуют
  // серверных сервисов, которых в этом режиме нет.
  await expect(card.getByRole("button", { name: "Attachments" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "AI insight" })).toHaveCount(0);
});

test("выход из гостевого режима не стирает данные", async ({ page }) => {
  await enterGuest(page);
  await createList(page, "Останется в браузере");

  await visible(page, "guest-exit").click();
  await expect(visible(page, "sign-in-google")).toBeVisible();

  // Повторный вход возвращает те же списки: cookie снимается, localStorage — нет.
  await visible(page, "sign-in-guest").click();
  await expect(onlyListCard(page).getByTestId("list-title")).toHaveText(
    "Останется в браузере",
  );
});

test("выключенная настройка убирает гостевой вход", async ({ page, db }) => {
  await setGuestMode(db, false);

  await page.goto("/en");
  await expect(visible(page, "sign-in-google")).toBeVisible();
  await expect(visible(page, "sign-in-guest")).toHaveCount(0);
});
