/**
 * @file spaces.e2e.ts
 * @description Пространства: переключение, создание, лимит и удаление.
 *
 * Здесь проверяется путь `URL → провайдер → Action → Prisma-фильтр` целиком:
 * потеря `spaceId` на любом участке видна как чужие или пропавшие списки.
 */

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { makeList, makeSpace } from "./factories";
import { listCard, openSpace, visible } from "./helpers";

/**
 * Переключатель в шапке. Компонент рендерится дважды — вариант `header` для
 * широкого экрана и `page` для узкого; в DOM есть оба, видим ровно один.
 */
function switcher(page: Page) {
  return page.locator('[data-testid="space-switcher"][data-variant="header"]');
}

test("переключение пространства меняет URL и набор списков", async ({
  page,
  user,
  db,
}) => {
  const second = await makeSpace(db, user.id, "Работа");
  const personal = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Личный список",
  });
  const work = await makeList(db, user.id, second.id, { title: "Рабочий список" });

  await openSpace(page, user);
  await expect(listCard(page, personal.id)).toBeVisible();
  await expect(listCard(page, work.id)).toHaveCount(0);

  await switcher(page).getByTestId("space-switcher-trigger").click();
  await switcher(page)
    .locator(`[data-testid="space-option"][data-space-id="${second.id}"]`)
    .click();

  await expect(page).toHaveURL(`/en/spaces/${second.id}`);
  await expect(listCard(page, work.id)).toBeVisible();
  await expect(listCard(page, personal.id)).toHaveCount(0);
});

test("новое пространство создаётся и сразу открывается", async ({
  page,
  user,
  db,
}) => {
  await openSpace(page, user);

  await switcher(page).getByTestId("space-switcher-trigger").click();
  await switcher(page).getByTestId("space-create-open").click();
  await switcher(page).getByTestId("space-name-input").fill("Путешествия");
  await switcher(page).getByTestId("space-name-save").click();

  await expect
    .poll(() =>
      db.space.count({ where: { userId: user.id, name: "Путешествия" } }),
    )
    .toBe(1);
  const created = await db.space.findFirstOrThrow({
    where: { userId: user.id, name: "Путешествия" },
  });

  await expect(page).toHaveURL(`/en/spaces/${created.id}`);
  await expect(visible(page, "lists-empty")).toBeVisible();
});

test("сверх лимита пространство создать нельзя", async ({ page, user, db }) => {
  for (let index = 1; index <= 5; index += 1) {
    await makeSpace(db, user.id, `Пространство ${index}`);
  }

  await openSpace(page, user);
  await switcher(page).getByTestId("space-switcher-trigger").click();

  // Пять дополнительных пространств — предел; кнопка создания заблокирована.
  await expect(switcher(page).getByTestId("space-create-open")).toBeDisabled();
  expect(await db.space.count({ where: { userId: user.id } })).toBe(6);
});

test("удаление пространства требует ввода его имени", async ({
  page,
  user,
  db,
}) => {
  const doomed = await makeSpace(db, user.id, "Временное");
  const list = await makeList(db, user.id, doomed.id, { title: "Внутри" });

  await openSpace(page, user, doomed.id);
  await switcher(page).getByTestId("space-switcher-trigger").click();
  await switcher(page).getByTestId("space-delete-open").click();

  const input = switcher(page).getByTestId("space-delete-input");
  await expect(input).toBeVisible();

  // Неверное имя удаление не выполняет.
  await input.fill("Не то имя");
  await switcher(page).getByTestId("space-delete-confirm").click();
  await expect(page).toHaveURL(`/en/spaces/${doomed.id}`);
  expect(await db.space.count({ where: { id: doomed.id } })).toBe(1);

  await input.fill("Временное");
  await switcher(page).getByTestId("space-delete-confirm").click();

  // После удаления пользователь возвращается в default-пространство.
  await expect(page).toHaveURL(`/en/spaces/${user.defaultSpaceId}`);
  expect(await db.space.count({ where: { id: doomed.id } })).toBe(0);
  // Списки удалённого пространства удаляются каскадом.
  expect(await db.list.count({ where: { id: list.id } })).toBe(0);
});

test("default-пространство удалить нельзя", async ({ page, user }) => {
  await openSpace(page, user);
  await switcher(page).getByTestId("space-switcher-trigger").click();

  await expect(switcher(page).getByTestId("space-delete-open")).toHaveCount(0);
});
