/**
 * @file item-move-to-list.e2e.ts
 * @description Перенос записи в другой список броском на его карточку.
 *
 * Сам `moveItemToList` покрыт интеграционными тестами, и повторять их здесь
 * незачем. Проверяется ровно то, чего они не видят: цель определяется по
 * геометрии карточек, поэтому существует только в настоящем браузере. Отсюда
 * же и состав файла — попадание в чужую карточку, промах мимо всех, ручка у
 * единственной записи и запрет для подпункта.
 */

import { expect, test } from "./fixtures";
import { makeItems, makeList, makeSubItems } from "./factories";
import {
  dragItemToList,
  dragItemToPoint,
  itemNames,
  itemRow,
  listCard,
  openItemMenu,
  openSpace,
  pointerEvents,
  subItemNames,
  subItemRow,
  visible,
} from "./helpers";

test("бросок записи на чужую карточку переносит её в тот список", async ({
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
  await makeItems(db, target.id, ["Чужая"]);
  await openSpace(page, user);

  const sourceCard = listCard(page, source.id);
  const targetCard = listCard(page, target.id);

  await dragItemToList(page, sourceCard, second.id, target.id, async () => {
    // Единственный момент, когда видны оба признака цели: указатель над чужой
    // карточкой, кнопка ещё не отпущена.
    await expect(targetCard).toHaveAttribute("data-item-drop-active", "true");
    // Плашка за курсором: строка сама в соседнюю колонку не уезжает, и без
    // неё за указателем не следовало бы ничего.
    await expect(visible(page, "item-drag-preview")).toBeVisible();
    // Пока идёт жест, страница не отвечает на наведение: курсор проходит над
    // вкладками и кнопками, а бросок туда ничего не делает.
    expect(await pointerEvents(visible(page, "tab-search"))).toBe("none");
  });

  await expect.poll(() => itemNames(sourceCard)).toEqual(["Первая"]);
  await expect.poll(() => itemNames(targetCard)).toEqual(["Чужая", "Вторая"]);
  // Подсветка снимается вместе с жестом, иначе карточка осталась бы в кольце.
  await expect(targetCard).not.toHaveAttribute("data-item-drop-active", "true");
  // И страница снова кликабельна: забытый запрет наведения оставил бы её
  // мёртвой до перезагрузки.
  expect(await pointerEvents(visible(page, "tab-search"))).not.toBe("none");

  // Перенос — это смена `listId` у существующей строки, а не копия.
  const moved = await db.item.findUnique({
    where: { id: second.id },
    select: { listId: true },
  });
  expect(moved?.listId).toBe(target.id);
  // Счёт только по спискам этого теста: прогон параллельный, и одноимённые
  // записи чужих пользователей попали бы в общий счёт по таблице.
  expect(
    await db.item.count({
      where: { name: "Вторая", listId: { in: [source.id, target.id] } },
    }),
  ).toBe(1);

  await page.reload();
  await expect.poll(() => itemNames(listCard(page, target.id))).toEqual([
    "Чужая",
    "Вторая",
  ]);
});

test("бросок мимо карточек оставляет запись в своём списке, а строка не покидает список", async ({
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
  // Границей служит сам список записей, а не карточка: под списком в карточке
  // лежат форма добавления, кнопки и бейджи групп — сотни пикселей, внутри
  // которых строка могла бы уехать и без ограничения.
  const listBox = await sourceCard.getByTestId("items-list").boundingBox();
  if (!listBox) throw new Error("Нет геометрии списка записей");

  // Правый нижний угол окна: карточек там нет, значит нет и цели.
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Нет размеров окна");
  await dragItemToPoint(
    page,
    sourceCard,
    second.id,
    { x: viewport.width - 5, y: viewport.height - 5 },
    async () => {
      const rowBox = await itemRow(sourceCard, second.id).boundingBox();
      if (!rowBox) throw new Error("Нет геометрии перетаскиваемой строки");

      // Указатель уехал в угол окна, а строка осталась в своём списке: её
      // держит `dragConstraints`. Запас — на упругий край: он берёт малую
      // долю от перелёта, и на таком расстоянии это около десятка пикселей. Без
      // ограничения строка стояла бы под самым курсором, на две сотни
      // пикселей ниже списка, — ради этого ограничение и появилось.
      expect(rowBox.y + rowBox.height).toBeLessThan(
        listBox.y + listBox.height + 30,
      );
    },
  );

  await expect.poll(() => itemNames(sourceCard)).toEqual(["Первая", "Вторая"]);
  await expect.poll(() => itemNames(listCard(page, target.id))).toEqual([]);

  const stayed = await db.item.findUnique({
    where: { id: second.id },
    select: { listId: true },
  });
  expect(stayed?.listId).toBe(source.id);
});

test("единственная запись получает ручку, только когда есть куда её унести", async ({
  page,
  user,
  db,
}) => {
  const alone = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Одинокий",
  });
  const [only] = await makeItems(db, alone.id, ["Единственная"]);
  await openSpace(page, user);

  const aloneCard = listCard(page, alone.id);
  // Список в пространстве один: переставлять нечего и переносить некуда.
  await expect(aloneCard.getByTestId("item-drag-handle")).toHaveCount(0);

  const target = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Получатель",
  });
  await page.reload();

  const cardAgain = listCard(page, alone.id);
  await expect(
    itemRow(cardAgain, only.id).getByTestId("item-drag-handle"),
  ).toBeVisible();

  // Ручка появилась, но перестановка по-прежнему невозможна: соседей у записи
  // нет, и пункты меню остаются скрытыми — условия у жеста и у перестановки
  // разные.
  const menu = await openItemMenu(cardAgain, only.id);
  await expect(menu.getByTestId("item-move-up")).toHaveCount(0);
  await expect(menu.getByTestId("item-move-down")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await dragItemToList(page, cardAgain, only.id, target.id);

  await expect.poll(() => itemNames(listCard(page, target.id))).toEqual([
    "Единственная",
  ]);
});

test("подпункт на чужую карточку не переезжает", async ({ page, user, db }) => {
  const source = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Источник",
  });
  const target = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Получатель",
  });
  const [parent] = await makeItems(db, source.id, ["Пункт"]);
  const [firstSub] = await makeSubItems(db, source.id, parent.id, [
    "Первый",
    "Второй",
  ]);
  await openSpace(page, user);

  const sourceCard = listCard(page, source.id);
  const handle = subItemRow(sourceCard, firstSub.id).getByTestId(
    "item-drag-handle",
  );
  const handleBox = await handle.boundingBox();
  const targetBox = await listCard(page, target.id).boundingBox();
  if (!handleBox || !targetBox) throw new Error("Нет геометрии для жеста");

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2 + 8,
    { steps: 3 },
  );
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 24 },
  );
  // Подпункт принадлежит родителю: цели для него не ищутся вовсе, поэтому
  // карточка под указателем не подсвечивается.
  await expect(listCard(page, target.id)).not.toHaveAttribute(
    "data-item-drop-active",
    "true",
  );
  await page.mouse.up();

  await expect.poll(() => subItemNames(sourceCard, parent.id)).toEqual([
    "Первый",
    "Второй",
  ]);
  await expect.poll(() => itemNames(listCard(page, target.id))).toEqual([]);

  const stayed = await db.item.findUnique({
    where: { id: firstSub.id },
    select: { listId: true, parentId: true },
  });
  expect(stayed).toEqual({ listId: source.id, parentId: parent.id });
});
