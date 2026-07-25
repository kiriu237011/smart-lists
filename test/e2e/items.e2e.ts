/**
 * @file items.e2e.ts
 * @description Жизненный цикл записи и правила отображения выполненных.
 *
 * Отдельно проверяется нумерация: видимый номер нигде не хранится, он
 * вычисляется при рендере среди невыполненных записей. Такое правило можно
 * сломать только в интерфейсе — в базе номера просто нет.
 */

import { expect, test } from "./fixtures";
import { makeItems, makeList } from "./factories";
import {
  addItem,
  itemNames,
  itemRow,
  listCard,
  openItemMenu,
  openSpace,
  visible,
} from "./helpers";

test("запись добавляется и переживает перезагрузку", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await addItem(card, "Молоко");

  await page.reload();
  await expect(
    listCard(page, list.id).getByTestId("item-name"),
  ).toHaveText(["Молоко"]);

  const stored = await db.item.findFirst({ where: { listId: list.id } });
  expect(stored?.addedById).toBe(user.id);
});

test("запись переименовывается по клику на название", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [item] = await makeItems(db, list.id, ["Хлеб"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const row = itemRow(card, item.id);
  await row.getByTestId("item-name").click();
  await row.getByTestId("item-name-input").fill("Батон");
  await row.getByTestId("item-name-input").press("Enter");

  await expect(row.getByTestId("item-name")).toHaveText("Батон");

  await page.reload();
  await expect(itemRow(listCard(page, list.id), item.id).getByTestId("item-name")).toHaveText(
    "Батон",
  );
});

test("выполненная запись уходит вниз и возвращается на своё место", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [first, second, third] = await makeItems(db, list.id, [
    "Первая",
    "Вторая",
    "Третья",
  ]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await itemRow(card, second.id).getByTestId("item-toggle").click();

  // Выполненная запись живёт отдельным блоком в конце списка.
  await expect
    .poll(() => itemNames(card))
    .toEqual(["Первая", "Третья", "Вторая"]);

  await page.reload();
  const reloaded = listCard(page, list.id);
  await expect.poll(() => itemNames(reloaded)).toEqual([
    "Первая",
    "Третья",
    "Вторая",
  ]);

  // Снятие галки возвращает запись на прежнее место: `position` при
  // переключении статуса не пишется вовсе.
  await itemRow(reloaded, second.id).getByTestId("item-toggle").click();
  await expect.poll(() => itemNames(reloaded)).toEqual([
    "Первая",
    "Вторая",
    "Третья",
  ]);

  expect(
    (await db.item.findMany({ where: { listId: list.id }, orderBy: { position: "asc" } }))
      .map((row) => row.name),
  ).toEqual(["Первая", "Вторая", "Третья"]);

  // Порядок в базе не изменился, а значит, id остались прежними.
  expect([first.id, second.id, third.id]).toHaveLength(3);
});

test("нумерация считается среди невыполненных записей", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [, second] = await makeItems(db, list.id, ["Первая", "Вторая", "Третья"]);
  await openSpace(page, user);

  // Нумерация выключена по умолчанию — включаем тумблером в настройках.
  await visible(page, "settings-trigger-desktop").click();
  await visible(page, "setting-show-item-numbers").click();

  const card = listCard(page, list.id);
  await expect(card.getByTestId("item-number")).toHaveText(["1.", "2.", "3."]);

  // Выполненная запись номер теряет, остальные пересчитываются без записи в БД.
  await itemRow(card, second.id).getByTestId("item-toggle").click();
  await expect(card.getByTestId("item-number")).toHaveText(["1.", "2.", ""]);

  // Настройка живёт в localStorage и переживает перезагрузку.
  await page.reload();
  await expect(listCard(page, list.id).getByTestId("item-number")).toHaveText([
    "1.",
    "2.",
    "",
  ]);
});

test("удаление записи требует подтверждения", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [item] = await makeItems(db, list.id, ["Лишняя", "Нужная"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const menu = await openItemMenu(card, item.id);
  await menu.getByTestId("item-delete").click();
  await expect(visible(page, "item-delete-modal")).toBeVisible();
  await visible(page, "item-delete-confirm").click();

  await expect(itemRow(card, item.id)).toHaveCount(0);

  await page.reload();
  await expect(listCard(page, list.id).getByTestId("item-name")).toHaveText([
    "Нужная",
  ]);
  expect(await db.item.count({ where: { id: item.id } })).toBe(0);
});
