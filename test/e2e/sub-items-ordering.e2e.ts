/**
 * @file sub-items-ordering.e2e.ts
 * @description Порядок подпунктов: жест и доступная с клавиатуры альтернатива.
 *
 * Главное, что проверяется здесь, — независимость уровней. Каждый пункт держит
 * собственную область перетаскивания, поэтому подпункт не может уехать к
 * другому родителю, а пункт едет вместе со всем своим блоком. Проверить это
 * можно только настоящим жестом в браузере.
 */

import { expect, test } from "./fixtures";
import { makeItems, makeList, makeSubItems } from "./factories";
import {
  dragItemOnto,
  dragSubItemOnto,
  itemRow,
  listCard,
  openSpace,
  subItemNames,
  subItemRow,
  visible,
} from "./helpers";

/** Названия пунктов верхнего уровня в порядке отображения. */
async function topLevelNames(card: import("@playwright/test").Locator) {
  return card
    .getByTestId("item")
    .evaluateAll((rows) =>
      rows.map(
        (row) =>
          row.querySelector('[data-testid="item-name"]')?.textContent ?? "",
      ),
    );
}

test("перетаскивание подпункта меняет порядок и сохраняет его", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  const [a, , c] = await makeSubItems(db, list.id, parent.id, ["A", "B", "C"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await dragSubItemOnto(page, card, c.id, a.id);

  await expect.poll(() => subItemNames(card, parent.id)).toEqual(["C", "A", "B"]);

  await page.reload();
  await expect
    .poll(() => subItemNames(listCard(page, list.id), parent.id))
    .toEqual(["C", "A", "B"]);

  const stored = await db.item.findMany({
    where: { parentId: parent.id },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { name: true },
  });
  expect(stored.map((row) => row.name)).toEqual(["C", "A", "B"]);
});

test("подпункт не уходит к другому пункту при перетаскивании", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [first, second] = await makeItems(db, list.id, ["Ужин", "Уборка"]);
  const [a] = await makeSubItems(db, list.id, first.id, ["A", "B"]);
  const [x] = await makeSubItems(db, list.id, second.id, ["X", "Y"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  // Тянем подпункт первого блока на подпункт второго: областей две, и жест не
  // знает о существовании соседней.
  await dragSubItemOnto(page, card, a.id, x.id);

  const moved = await db.item.findUniqueOrThrow({ where: { id: a.id } });
  expect(moved.parentId).toBe(first.id);
  expect(await subItemNames(card, second.id)).toEqual(["X", "Y"]);
  expect(await db.item.count({ where: { parentId: second.id } })).toBe(2);
});

test("перетаскивание пункта уносит его подпункты", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [first, second] = await makeItems(db, list.id, ["Ужин", "Уборка"]);
  await makeSubItems(db, list.id, first.id, ["A", "B"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await dragItemOnto(page, card, second.id, first.id);

  await expect.poll(() => topLevelNames(card)).toEqual(["Уборка", "Ужин"]);
  // Подпункты по-прежнему внутри своего пункта: позиции у них свои и жестом
  // верхнего уровня не затрагиваются.
  expect(await subItemNames(card, first.id)).toEqual(["A", "B"]);
  expect(
    (await db.item.findMany({ where: { parentId: first.id } })).length,
  ).toBe(2);
});

test("пункты меню двигают подпункт вверх и вниз", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  const [a, b] = await makeSubItems(db, list.id, parent.id, ["A", "B", "C"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const row = subItemRow(card, b.id);

  // Клавиатурная альтернатива жесту: ручка помечена aria-hidden.
  await row.getByTestId("item-menu-trigger").click();
  await row.getByTestId("item-menu").getByTestId("item-move-up").click();
  await expect.poll(() => subItemNames(card, parent.id)).toEqual(["B", "A", "C"]);

  await row.getByTestId("item-menu-trigger").click();
  await row.getByTestId("item-menu").getByTestId("item-move-down").click();
  await expect.poll(() => subItemNames(card, parent.id)).toEqual(["A", "B", "C"]);

  // Крайние записи уровня границу не переходят.
  const firstRow = subItemRow(card, a.id);
  await firstRow.getByTestId("item-menu-trigger").click();
  await expect(
    firstRow.getByTestId("item-menu").getByTestId("item-move-up"),
  ).toBeDisabled();
});

test("уровни независимы: единственный пункт не мешает двигать подпункты", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  const [a, b] = await makeSubItems(db, list.id, parent.id, ["A", "B"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  // Ручек ровно две — по одной на подпункт. У единственного пункта её нет:
  // двигать его некуда, а его подпункты двигать можно, потому что уровень свой.
  await expect(card.getByTestId("item-drag-handle")).toHaveCount(2);
  await expect(
    subItemRow(card, a.id).getByTestId("item-drag-handle"),
  ).toBeVisible();

  await dragSubItemOnto(page, card, b.id, a.id);
  await expect.poll(() => subItemNames(card, parent.id)).toEqual(["B", "A"]);
});

test("при поиске порядок подпунктов менять нельзя", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Поездка",
  });
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  const [a] = await makeSubItems(db, list.id, parent.id, ["Палатка", "Спальник"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await expect(
    subItemRow(card, a.id).getByTestId("item-drag-handle"),
  ).toBeVisible();

  // Ищем по названию подпункта: поиск по названию списка совпавших записей не
  // даёт и потому подмножества не создаёт — ограничивать там нечего.
  await visible(page, "tab-search").click();
  await visible(page, "search-input").fill("Спальник");

  // Виден весь блок, но перестановка запрещена: при поиске порядок можно было
  // бы менять через скрытые записи.
  const searchCard = listCard(page, list.id);
  await expect
    .poll(() => subItemNames(searchCard, parent.id))
    .toEqual(["Палатка", "Спальник"]);
  await expect(searchCard.getByTestId("item-drag-handle")).toHaveCount(0);

  const menuRow = subItemRow(searchCard, a.id);
  await menuRow.getByTestId("item-menu-trigger").click();
  await expect(
    menuRow.getByTestId("item-menu").getByTestId("item-move-down"),
  ).toHaveCount(0);
});

test("выполненный подпункт ручку теряет", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  const [a] = await makeSubItems(db, list.id, parent.id, ["A", "B", "C"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await subItemRow(card, a.id).getByTestId("item-toggle").click();

  // Выполненные уходят в конец секции, нумерации не имеют и перетаскиванию
  // не подлежат — как и на верхнем уровне.
  await expect.poll(() => subItemNames(card, parent.id)).toEqual(["B", "C", "A"]);
  await expect(
    subItemRow(card, a.id).getByTestId("item-drag-handle"),
  ).toHaveCount(0);
  // Ручки остались у двух невыполненных подпунктов.
  await expect(itemRow(card, parent.id).getByTestId("item-drag-handle")).toHaveCount(2);
});
