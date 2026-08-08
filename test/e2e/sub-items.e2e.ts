/**
 * @file sub-items.e2e.ts
 * @description Подпункты в интерфейсе: создание, синхронизация отметок,
 *              нумерация «x.y», счётчик и удаление блока.
 *
 * Здесь проверяется то, чего не видят юниты и интеграционные тесты: связка
 * «клик по чекбоксу → оптимистичное состояние → Server Action → свежий RSC
 * payload». Правило синхронизации отметок существует в трёх реализациях —
 * `item-tree`, Server Action и гостевое хранилище, — и разъехаться они могут
 * именно на этом стыке.
 */

import { expect, test } from "./fixtures";
import { makeItems, makeList, makeSubItems } from "./factories";
import {
  addSubItem,
  itemRow,
  listCard,
  openItemMenu,
  openSpace,
  ownControl,
  subItemNames,
  subItemRow,
  visible,
} from "./helpers";

test("подпункт создаётся из меню и переживает перезагрузку", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await addSubItem(card, parent.id, "Купить продукты");

  // Поле остаётся открытым: подпункты набирают очередью.
  const row = itemRow(card, parent.id);
  await expect(row.getByTestId("add-sub-item-input")).toBeVisible();
  await row.getByTestId("add-sub-item-input").fill("Приготовить");
  await row.getByTestId("add-sub-item-submit").click();
  await expect
    .poll(() => subItemNames(card, parent.id))
    .toEqual(["Купить продукты", "Приготовить"]);

  await page.reload();
  // Через poll, а не разовым чтением: `allInnerTexts` не ждёт появления узлов
  // и сразу после перезагрузки вернул бы пустой массив.
  await expect
    .poll(() => subItemNames(listCard(page, list.id), parent.id))
    .toEqual(["Купить продукты", "Приготовить"]);

  const stored = await db.item.findMany({
    where: { parentId: parent.id },
    orderBy: { position: "asc" },
    select: { name: true, listId: true },
  });
  expect(stored).toEqual([
    { name: "Купить продукты", listId: list.id },
    { name: "Приготовить", listId: list.id },
  ]);

  // Пункты верхнего уровня подпунктом не пополнились: он живёт внутри блока.
  await expect(card.getByTestId("item")).toHaveCount(1);
});

test("поле ввода подпункта закрывается по Escape", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const menu = await openItemMenu(card, parent.id);
  await menu.getByTestId("item-add-sub-item").click();

  const row = itemRow(card, parent.id);
  await expect(row.getByTestId("add-sub-item-input")).toBeVisible();
  await row.getByTestId("add-sub-item-input").press("Escape");

  await expect(row.getByTestId("add-sub-item-input")).toBeHidden();
  expect(await db.item.count({ where: { parentId: parent.id } })).toBe(0);
});

test("отметка пункта проставляется всем подпунктам и снимается с них", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  const subItems = await makeSubItems(db, list.id, parent.id, ["Купить", "Готовить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await ownControl(card, parent.id, "item-toggle").click();

  // Выполненный блок сворачивается сам, поэтому раскрываем его вручную:
  // проверяем отметки подпунктов, а не автосворачивание.
  await ownControl(card, parent.id, "sub-items-toggle").click();
  for (const subItem of subItems) {
    await expect(
      subItemRow(card, subItem.id).getByTestId("item-toggle"),
    ).toHaveAttribute("data-completed", "true");
  }
  await expect
    .poll(async () =>
      (await db.item.findMany({ where: { listId: list.id } })).every(
        (item) => item.isCompleted,
      ),
    )
    .toBe(true);

  // Снятие отметки с пункта снимает её со всех подпунктов — то же правило,
  // записанное с другой стороны.
  await ownControl(card, parent.id, "item-toggle").click();
  await expect
    .poll(async () =>
      (await db.item.findMany({ where: { listId: list.id } })).every(
        (item) => !item.isCompleted,
      ),
    )
    .toBe(true);
});

test("пункт выполняется, когда отмечен последний подпункт", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  const [first, second] = await makeSubItems(db, list.id, parent.id, [
    "Купить",
    "Готовить",
  ]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const parentToggle = ownControl(card, parent.id, "item-toggle");

  await subItemRow(card, first.id).getByTestId("item-toggle").click();
  await expect(parentToggle).toHaveAttribute("data-completed", "false");

  await subItemRow(card, second.id).getByTestId("item-toggle").click();
  await expect(parentToggle).toHaveAttribute("data-completed", "true");

  // Снятие отметки с одного подпункта возвращает пункт в невыполненные.
  // Готовый блок свернулся сам — раскрываем, чтобы добраться до подпункта.
  await ownControl(card, parent.id, "sub-items-toggle").click();
  await subItemRow(card, first.id).getByTestId("item-toggle").click();
  await expect(parentToggle).toHaveAttribute("data-completed", "false");

  await page.reload();
  await expect(
    ownControl(listCard(page, list.id), parent.id, "item-toggle"),
  ).toHaveAttribute("data-completed", "false");
});

test("выполненный подпункт уходит в конец своей секции", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  const [first] = await makeSubItems(db, list.id, parent.id, ["A", "B", "C"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await subItemRow(card, first.id).getByTestId("item-toggle").click();

  await expect.poll(() => subItemNames(card, parent.id)).toEqual(["B", "C", "A"]);

  // Позиции в базе не менялись: порядок отображения — следствие отметки.
  const stored = await db.item.findMany({
    where: { parentId: parent.id },
    orderBy: { position: "asc" },
    select: { name: true },
  });
  expect(stored.map((row) => row.name)).toEqual(["A", "B", "C"]);
});

test("выполненный блок уходит вниз списка вместе с подпунктами", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent, other] = await makeItems(db, list.id, ["Ужин", "Уборка"]);
  await makeSubItems(db, list.id, parent.id, ["Купить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await ownControl(card, parent.id, "item-toggle").click();

  await expect
    .poll(() => card.getByTestId("item").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-item-id")),
    ))
    .toEqual([other.id, parent.id]);
  // Подпункт по-прежнему внутри своего блока, а не отдельной записью списка:
  // готовый блок свёрнут, поэтому раскрываем его и смотрим содержимое.
  await ownControl(card, parent.id, "sub-items-toggle").click();
  await expect.poll(() => subItemNames(card, parent.id)).toEqual(["Купить"]);
});

test("подпункты нумеруются как x.y среди невыполненных", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [, second] = await makeItems(db, list.id, ["Первый", "Второй"]);
  const [subFirst] = await makeSubItems(db, list.id, second.id, ["A", "B"]);
  await openSpace(page, user);

  // Нумерация выключена по умолчанию — включаем тумблером в настройках.
  await visible(page, "settings-trigger-desktop").click();
  await visible(page, "setting-show-item-numbers").click();

  const card = listCard(page, list.id);
  await expect(card.getByTestId("item-number")).toHaveText(["1.", "2.", "2.1.", "2.2."]);

  // Выполненный подпункт номер теряет, а следующий занимает его место.
  await subItemRow(card, subFirst.id).getByTestId("item-toggle").click();
  await expect(card.getByTestId("item-number")).toHaveText(["1.", "2.", "2.1.", ""]);
});

test("счётчик в шапке считает только верхний уровень", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent, other] = await makeItems(db, list.id, ["Ужин", "Уборка"]);
  const [first, second] = await makeSubItems(db, list.id, parent.id, [
    "Купить",
    "Готовить",
  ]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  // Два пункта верхнего уровня, подпункты в знаменатель не входят.
  await expect(card.getByTestId("list-items-counter")).toHaveText("0 / 2");

  // Частично выполненный пункт честно считается невыполненным.
  await subItemRow(card, first.id).getByTestId("item-toggle").click();
  await expect(card.getByTestId("list-items-counter")).toHaveText("0 / 2");

  await subItemRow(card, second.id).getByTestId("item-toggle").click();
  await expect(card.getByTestId("list-items-counter")).toHaveText("1 / 2");

  await ownControl(card, other.id, "item-toggle").click();
  await expect(card.getByTestId("list-items-counter")).toHaveText("2 / 2");
});

test("удаление пункта предупреждает о подпунктах и уносит их", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин", "Уборка"]);
  await makeSubItems(db, list.id, parent.id, ["Купить", "Готовить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const menu = await openItemMenu(card, parent.id);
  await menu.getByTestId("item-delete").click();

  const modal = visible(page, "item-delete-modal");
  // Подпункты могут быть не на виду, а отменить удаление нельзя: их число
  // должно быть в подтверждении.
  await expect(modal).toContainText("2");
  await modal.getByTestId("item-delete-confirm").click();

  await expect(card.getByTestId("item")).toHaveCount(1);
  await expect.poll(() => db.item.count({ where: { listId: list.id } })).toBe(1);
});

test("у подпункта нет команд, которые к нему не относятся", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  await makeList(db, user.id, user.defaultSpaceId, { title: "Другой список" });
  const [subItem] = await makeSubItems(db, list.id, parent.id, ["Купить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const row = subItemRow(card, subItem.id);
  await row.getByTestId("item-menu-trigger").click();
  const menu = row.getByTestId("item-menu");
  await expect(menu).toBeVisible();

  // Подпункт принадлежит родителю: отдельно в другой список он не едет и
  // своих подпунктов иметь не может.
  await expect(menu.getByTestId("item-move-to-list")).toHaveCount(0);
  await expect(menu.getByTestId("item-add-sub-item")).toHaveCount(0);
  // Удаление и заметка подпункту доступны.
  await expect(menu.getByTestId("item-delete")).toBeVisible();
  await expect(menu.getByTestId("item-note-add")).toBeVisible();
});

test("подпункт получает собственную заметку", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  const [subItem] = await makeSubItems(db, list.id, parent.id, ["Купить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const row = subItemRow(card, subItem.id);
  await row.getByTestId("item-menu-trigger").click();
  await row.getByTestId("item-menu").getByTestId("item-note-add").click();

  await row.getByTestId("note-textarea").fill("Молоко и хлеб");
  await row.getByTestId("note-save").click();

  await expect
    .poll(async () =>
      (await db.item.findUniqueOrThrow({ where: { id: subItem.id } })).note,
    )
    .toBe("Молоко и хлеб");
});
