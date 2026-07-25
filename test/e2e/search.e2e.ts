/**
 * @file search.e2e.ts
 * @description Поиск по названиям, записям и заметкам.
 *
 * `ListsContainer` отдаёт список записей целиком и отдельно ID совпадений:
 * если подменить массив, номера записей начнут считаться по подмножеству.
 * Проверяется именно наблюдаемое поведение — что видно и что подсвечено.
 */

import { expect, test } from "./fixtures";
import { makeItems, makeList } from "./factories";
import { listCard, localStorageItem, openSpace, visible } from "./helpers";

/** Готовит два списка: один совпадает по названию, второй — по записи и заметке. */
async function seed(db: Parameters<typeof makeList>[0], userId: string, spaceId: string) {
  const groceries = await makeList(db, userId, spaceId, { title: "Продукты" });
  await makeItems(db, groceries.id, ["Молоко", "Хлеб"]);

  const trip = await makeList(db, userId, spaceId, { title: "Поездка" });
  await makeItems(db, trip.id, ["Палатка", "Спальник"]);
  await db.list.update({
    where: { id: trip.id },
    data: { note: "Не забыть про молоко в дорогу" },
  });

  return { groceries, trip };
}

test("поиск находит по названию записи и подсвечивает совпадение", async ({
  page,
  user,
  db,
}) => {
  const { groceries, trip } = await seed(db, user.id, user.defaultSpaceId);
  await openSpace(page, user);

  await visible(page, "tab-search").click();
  await visible(page, "search-input").fill("Палатка");

  await expect(visible(page, "search-results")).toHaveText("Search results: 1 of 2");
  await expect(listCard(page, groceries.id)).toHaveCount(0);

  const card = listCard(page, trip.id);
  // Внутри найденного списка показаны только совпавшие записи.
  await expect(card.getByTestId("item-name")).toHaveText(["Палатка"]);
  await expect(card.locator("mark")).toHaveText(["Палатка"]);
});

test("поиск находит по тексту заметки", async ({ page, user, db }) => {
  const { trip } = await seed(db, user.id, user.defaultSpaceId);
  await openSpace(page, user);

  await visible(page, "tab-search").click();
  await visible(page, "search-input").fill("дорогу");

  await expect(visible(page, "search-results")).toHaveText("Search results: 1 of 2");
  await expect(listCard(page, trip.id)).toBeVisible();
  // Фрагмент заметки виден прямо в карточке, без раскрытия панели.
  await expect(listCard(page, trip.id)).toContainText("дорогу");
});

test("поиск по названию списка оставляет все его записи", async ({
  page,
  user,
  db,
}) => {
  const { groceries } = await seed(db, user.id, user.defaultSpaceId);
  await openSpace(page, user);

  await visible(page, "tab-search").click();
  await visible(page, "search-input").fill("Продукты");

  const card = listCard(page, groceries.id);
  await expect(card.getByTestId("item-name")).toHaveText(["Молоко", "Хлеб"]);
});

test("пустой результат и сброс поиска", async ({ page, user, db }) => {
  await seed(db, user.id, user.defaultSpaceId);
  await openSpace(page, user);

  await visible(page, "tab-search").click();
  await visible(page, "search-input").fill("нет такого текста");

  await expect(visible(page, "lists-empty")).toBeVisible();
  await expect(visible(page, "search-results")).toHaveText("Search results: 0 of 2");

  await visible(page, "search-close").click();

  // Сброс возвращает вкладку создания и все списки.
  await expect(visible(page, "create-list-form")).toBeVisible();
  await expect(visible(page, "list-card")).toHaveCount(2);
});

test("открытая вкладка поиска переживает перезагрузку", async ({
  page,
  user,
  db,
}) => {
  await seed(db, user.id, user.defaultSpaceId);
  const other = await db.space.create({
    data: { userId: user.id, name: "Другое", normalizedName: "другое" },
  });
  await openSpace(page, user);

  await visible(page, "tab-search").click();
  await expect(visible(page, "search-input")).toBeVisible();

  await page.reload();
  await expect(visible(page, "search-input")).toBeVisible();
  expect(await localStorageItem(page, "activeTab")).toBe("search");

  // Ключ вкладки общий для всех пространств (в отличие от активной группы),
  // поэтому в другом пространстве поиск тоже остаётся открытым.
  await page.goto(`/en/spaces/${other.id}`);
  await expect(visible(page, "search-input")).toBeVisible();
});
