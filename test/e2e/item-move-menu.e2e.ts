/**
 * @file item-move-menu.e2e.ts
 * @description Перенос и копирование записи через меню и диалог выбора списка.
 *
 * Дополняет `item-move-to-list.e2e.ts`: там проверяется бросок на карточку, и
 * жест умеет только перенос. Копирование задаётся чекбоксом, поэтому диалог —
 * единственный путь к нему во всём интерфейсе.
 *
 * Сам `moveItemToList` покрыт интеграционными тестами в обоих режимах, и
 * повторять их здесь незачем. Непокрытым оставался ровно стык «чекбокс →
 * режим»: Action честно делает то, что ему передали, поэтому инвертированный
 * чекбokс оставил бы интеграционные тесты зелёными, а пользователь получил бы
 * перенос вместо копии — то есть запись УШЛА бы из исходного списка. Отсюда
 * состав файла: оба режима проверяются парой, а не поодиночке.
 *
 * Состояние «переносить некуда» здесь недостижимо и не проверяется: пункт меню
 * гейтится `hasMoveTargets`, и без целей до диалога дойти нельзя.
 */

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { makeItems, makeList } from "./factories";
import { itemNames, listCard, openItemMenu, openSpace, visible } from "./helpers";

/** Строка списка-получателя в диалоге. */
function moveTarget(page: Page, listId: string): Locator {
  return page.locator(
    `[data-testid="move-item-target"][data-list-id="${listId}"]:visible`,
  );
}

/** Открывает диалог выбора списка из меню записи. */
async function openMoveDialog(
  page: Page,
  card: Locator,
  itemId: string,
): Promise<void> {
  const menu = await openItemMenu(card, itemId);
  await menu.getByTestId("item-move-to-list").click();
  await expect(visible(page, "move-item-modal")).toBeVisible();
}

test("копирование через меню оставляет запись в исходном списке", async ({
  page,
  user,
  db,
}) => {
  const source = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Источник",
  });
  const target = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Получатель",
  });
  const [, second] = await makeItems(db, source.id, ["Первая", "Вторая"]);
  await openSpace(page, user);

  const sourceCard = listCard(page, source.id);
  await openMoveDialog(page, sourceCard, second.id);

  await visible(page, "move-item-copy").check();
  await moveTarget(page, target.id).click();

  // Главное отличие копии от переноса: запись осталась и там, и там.
  await expect
    .poll(() => itemNames(sourceCard))
    .toEqual(["Первая", "Вторая"]);
  await expect.poll(() => itemNames(listCard(page, target.id))).toEqual([
    "Вторая",
  ]);

  // Счёт только по спискам этого теста: прогон параллельный, и одноимённые
  // записи чужих пользователей попали бы в общий счёт по таблице.
  expect(
    await db.item.count({
      where: { name: "Вторая", listId: { in: [source.id, target.id] } },
    }),
  ).toBe(2);

  // Оригинал не тронут, а копия — отдельная строка, а не переехавшая та же.
  const original = await db.item.findUnique({
    where: { id: second.id },
    select: { listId: true },
  });
  expect(original?.listId).toBe(source.id);

  const copy = await db.item.findFirstOrThrow({
    where: { listId: target.id },
    select: { id: true, addedById: true },
  });
  expect(copy.id).not.toBe(second.id);
  expect(copy.addedById).toBe(user.id);

  await page.reload();
  await expect
    .poll(() => itemNames(listCard(page, source.id)))
    .toEqual(["Первая", "Вторая"]);
  await expect.poll(() => itemNames(listCard(page, target.id))).toEqual([
    "Вторая",
  ]);
});

test("без чекбокса запись переносится, а не копируется", async ({
  page,
  user,
  db,
}) => {
  // Парный к предыдущему: он ловит чекбокс, залипший во включённом состоянии,
  // этот — инвертированный или включённый по умолчанию. Поодиночке ни один из
  // них отличить перенос от копии не может.
  const source = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Источник",
  });
  const target = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Получатель",
  });
  const [, second] = await makeItems(db, source.id, ["Первая", "Вторая"]);
  await openSpace(page, user);

  const sourceCard = listCard(page, source.id);
  await openMoveDialog(page, sourceCard, second.id);

  // Умолчание — перенос: чекбокс снят, и его никто не трогает.
  await expect(visible(page, "move-item-copy")).not.toBeChecked();
  await moveTarget(page, target.id).click();

  await expect.poll(() => itemNames(sourceCard)).toEqual(["Первая"]);
  await expect.poll(() => itemNames(listCard(page, target.id))).toEqual([
    "Вторая",
  ]);

  expect(
    await db.item.count({
      where: { name: "Вторая", listId: { in: [source.id, target.id] } },
    }),
  ).toBe(1);

  // Перенос — смена `listId` у существующей строки: ID обязан сохраниться.
  const moved = await db.item.findUnique({
    where: { id: second.id },
    select: { listId: true },
  });
  expect(moved?.listId).toBe(target.id);
});

test("исходный список среди целей выбрать нельзя", async ({
  page,
  user,
  db,
}) => {
  const source = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Источник",
  });
  const target = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Получатель",
  });
  const [first] = await makeItems(db, source.id, ["Первая"]);
  await openSpace(page, user);

  await openMoveDialog(page, listCard(page, source.id), first.id);

  // Список-источник показан, но недоступен: убирать его из перечня нельзя —
  // тогда непонятно, где запись сейчас, а перенос в себя ничего не значит.
  await expect(moveTarget(page, source.id)).toBeDisabled();
  await expect(moveTarget(page, target.id)).toBeEnabled();
});

test("при нескольких группах цель выбирается в два шага", async ({
  page,
  user,
  db,
}) => {
  const source = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Источник",
  });
  const target = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Получатель",
  });
  const group = await db.listGroup.create({
    data: {
      userId: user.id,
      spaceId: user.defaultSpaceId,
      name: "Работа",
      position: 1,
    },
  });
  await db.listGroupMembership.create({
    data: { groupId: group.id, listId: target.id, position: 1 },
  });
  const [first] = await makeItems(db, source.id, ["Первая"]);
  await openSpace(page, user);

  await openMoveDialog(page, listCard(page, source.id), first.id);

  // Секций две — группа и «Без группы», поэтому первый шаг не пропускается и
  // списков на нём ещё нет.
  await expect(visible(page, "move-item-group")).toHaveCount(2);
  await expect(page.getByTestId("move-item-target")).toHaveCount(0);

  await page
    .locator(
      `[data-testid="move-item-group"][data-group-id="${group.id}"]:visible`,
    )
    .click();
  await expect(moveTarget(page, target.id)).toBeVisible();

  // Стрелка возвращает к выбору группы: Escape закрывает диалог целиком, и без
  // неё уйти со второго шага было бы некуда.
  await visible(page, "move-item-back").click();
  await expect(visible(page, "move-item-group")).toHaveCount(2);

  await page
    .locator(
      `[data-testid="move-item-group"][data-group-id="${group.id}"]:visible`,
    )
    .click();
  await moveTarget(page, target.id).click();

  await expect.poll(() => itemNames(listCard(page, source.id))).toEqual([]);
  await expect.poll(() => itemNames(listCard(page, target.id))).toEqual([
    "Первая",
  ]);
});
