/**
 * @file ordering.e2e.ts
 * @description Порядок записей: перетаскивание и клавиатурная альтернатива.
 *
 * Единственное место, где вообще можно проверить жест. `moveItem` покрыт
 * интеграционными тестами, но они не видят ни того, что жест стартует только с
 * ручки, ни того, что при активном поиске порядок менять нельзя.
 */

import { expect, test } from "./fixtures";
import { makeItems, makeList } from "./factories";
import {
  dragItemOnto,
  itemNames,
  itemRow,
  listCard,
  openItemMenu,
  openSpace,
  visible,
} from "./helpers";

test("перетаскивание за ручку меняет порядок и сохраняет его", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [first, , third] = await makeItems(db, list.id, [
    "Первая",
    "Вторая",
    "Третья",
  ]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await dragItemOnto(page, card, third.id, first.id);

  await expect.poll(() => itemNames(card)).toEqual(["Третья", "Первая", "Вторая"]);

  await page.reload();
  await expect.poll(() => itemNames(listCard(page, list.id))).toEqual([
    "Третья",
    "Первая",
    "Вторая",
  ]);

  const stored = await db.item.findMany({
    where: { listId: list.id },
    orderBy: { position: "asc" },
    select: { name: true },
  });
  expect(stored.map((row) => row.name)).toEqual(["Третья", "Первая", "Вторая"]);
});

test("перетаскивание за название порядок не меняет", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [first, , third] = await makeItems(db, list.id, [
    "Первая",
    "Вторая",
    "Третья",
  ]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const source = itemRow(card, third.id).getByTestId("item-name");
  const sourceBox = await source.boundingBox();
  const targetBox = await itemRow(card, first.id).boundingBox();
  if (!sourceBox || !targetBox) throw new Error("Нет геометрии строк");

  // Тот же жест, но начатый с названия: `dragListener={false}` не должен его
  // подхватить, иначе клик по названию конфликтует с редактированием.
  await page.mouse.move(sourceBox.x + 20, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + 20, targetBox.y + 2, { steps: 20 });
  await page.mouse.up();

  await expect.poll(() => itemNames(card)).toEqual(["Первая", "Вторая", "Третья"]);
});

test("пункты меню двигают запись вверх и вниз", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [, , third] = await makeItems(db, list.id, ["Первая", "Вторая", "Третья"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const menu = await openItemMenu(card, third.id);
  await menu.getByTestId("item-move-up").click();

  await expect.poll(() => itemNames(card)).toEqual(["Первая", "Третья", "Вторая"]);

  const menuAgain = await openItemMenu(card, third.id);
  await menuAgain.getByTestId("item-move-down").click();
  await expect.poll(() => itemNames(card)).toEqual(["Первая", "Вторая", "Третья"]);

  await page.reload();
  await expect.poll(() => itemNames(listCard(page, list.id))).toEqual([
    "Первая",
    "Вторая",
    "Третья",
  ]);
});

test("крайние записи не двигаются за пределы списка", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [first, , third] = await makeItems(db, list.id, [
    "Первая",
    "Вторая",
    "Третья",
  ]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const firstMenu = await openItemMenu(card, first.id);
  await expect(firstMenu.getByTestId("item-move-up")).toBeDisabled();

  await page.keyboard.press("Escape");
  const thirdMenu = await openItemMenu(card, third.id);
  await expect(thirdMenu.getByTestId("item-move-down")).toBeDisabled();
});

test("при активном поиске порядок менять нельзя", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [, second] = await makeItems(db, list.id, ["Молоко", "Хлеб", "Масло"]);
  await openSpace(page, user);

  await visible(page, "tab-search").click();
  await visible(page, "search-input").fill("Хлеб");
  await expect(visible(page, "search-results")).toBeVisible();

  const card = listCard(page, list.id);
  // Пользователь видит подмножество записей: перемещение перескакивало бы
  // через скрытые, поэтому и ручка, и пункты меню исчезают.
  await expect(card.getByTestId("item-drag-handle")).toHaveCount(0);

  const menu = await openItemMenu(card, second.id);
  await expect(menu.getByTestId("item-move-up")).toHaveCount(0);
  await expect(menu.getByTestId("item-move-down")).toHaveCount(0);
});
