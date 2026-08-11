/**
 * @file sub-items-collapse.e2e.ts
 * @description Сворачивание блока подпунктов.
 *
 * Свёрнутость — персональная настройка отображения: она живёт в localStorage
 * этого браузера и в БД не попадает. Проверяется ровно то, что видно на экране,
 * и то, что осталось в хранилище после перезагрузки.
 *
 * Три правила расходятся по источнику состояния, и различить их можно только
 * здесь: ручная свёртка сохраняется, автосворачивание выполненного блока —
 * следствие отметки и не сохраняется вовсе, а поиск раскрывает блок
 * принудительно, не трогая сохранённое.
 */

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { makeItems, makeList, makeSubItems } from "./factories";
import {
  itemRow,
  listCard,
  localStorageItem,
  openItemMenu,
  openSpace,
  ownControl,
  subItemNames,
  subItemRow,
  visible,
} from "./helpers";

/** ID свёрнутых блоков из localStorage. */
async function collapsedIds(page: Page, spaceId: string): Promise<string[]> {
  const raw = await localStorageItem(page, `collapsedItems:${spaceId}`);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

test("блок сворачивается вручную и переживает перезагрузку", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  await makeSubItems(db, list.id, parent.id, ["Купить", "Готовить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await expect(itemRow(card, parent.id).getByTestId("sub-items")).toBeVisible();

  await ownControl(card, parent.id, "sub-items-toggle").click();

  await expect(itemRow(card, parent.id).getByTestId("sub-items")).toHaveCount(0);
  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([parent.id]);

  await page.reload();
  await expect(
    itemRow(listCard(page, list.id), parent.id).getByTestId("sub-items"),
  ).toHaveCount(0);

  // Обратное действие возвращает подпункты и очищает хранилище.
  await ownControl(listCard(page, list.id), parent.id, "sub-items-toggle").click();
  await expect(
    itemRow(listCard(page, list.id), parent.id).getByTestId("sub-items"),
  ).toBeVisible();
  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([]);
});

test("свёрнутый блок показывает, сколько подпунктов выполнено", async ({
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
  await ownControl(card, parent.id, "sub-items-toggle").click();

  // Скрытые подпункты иначе никак не сосчитать — это единственный признак.
  await expect(
    ownControl(card, parent.id, "sub-items-counter"),
  ).toHaveText("1 / 3");
});

test("тумблер счётчика выключает его на обоих уровнях", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  await makeSubItems(db, list.id, parent.id, ["Купить", "Готовить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await ownControl(card, parent.id, "sub-items-toggle").click();

  // По умолчанию счётчик включён — видны оба.
  await expect(card.getByTestId("list-items-counter")).toBeVisible();
  await expect(ownControl(card, parent.id, "sub-items-counter")).toBeVisible();

  // Тумблер один: число по смыслу одно и то же, просто на разных уровнях.
  await visible(page, "settings-trigger-desktop").click();
  await visible(page, "setting-show-items-counter").click();

  await expect(card.getByTestId("list-items-counter")).toHaveCount(0);
  await expect(ownControl(card, parent.id, "sub-items-counter")).toHaveCount(0);
  // Сама кнопка сворачивания остаётся: она к счётчику отношения не имеет.
  await expect(ownControl(card, parent.id, "sub-items-toggle")).toBeVisible();

  // Настройка живёт в localStorage и переживает перезагрузку.
  await page.reload();
  await expect(
    ownControl(listCard(page, list.id), parent.id, "sub-items-counter"),
  ).toHaveCount(0);
});

test("выполненный блок сворачивается сам, а его разворот не сохраняется", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  await makeSubItems(db, list.id, parent.id, ["Купить", "Готовить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await ownControl(card, parent.id, "item-toggle").click();

  await expect(itemRow(card, parent.id).getByTestId("sub-items")).toHaveCount(0);
  // Автосворачивание — следствие отметки, а не выбор пользователя: в хранилище
  // ему делать нечего.
  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([]);

  // Раскрыть можно, но только до перезагрузки.
  await ownControl(card, parent.id, "sub-items-toggle").click();
  await expect(itemRow(card, parent.id).getByTestId("sub-items")).toBeVisible();
  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([]);

  await page.reload();
  await expect(
    itemRow(listCard(page, list.id), parent.id).getByTestId("sub-items"),
  ).toHaveCount(0);

  // Снятие отметки возвращает блок в раскрытое состояние.
  await ownControl(listCard(page, list.id), parent.id, "item-toggle").click();
  await expect(
    itemRow(listCard(page, list.id), parent.id).getByTestId("sub-items"),
  ).toBeVisible();
});

test("поиск раскрывает свёрнутый блок, не меняя сохранённое состояние", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Поездка",
  });
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  await makeSubItems(db, list.id, parent.id, ["Палатка", "Спальник"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await ownControl(card, parent.id, "sub-items-toggle").click();
  await expect(itemRow(card, parent.id).getByTestId("sub-items")).toHaveCount(0);

  await visible(page, "tab-search").click();
  await visible(page, "search-input").fill("Спальник");

  // Совпал подпункт: блок обязан раскрыться, иначе результат нельзя увидеть.
  // Показывается он целиком — производная отметка родителя и нумерация «x.y»
  // считаются по всем подпунктам, и половина блока их не объяснила бы.
  const searchCard = listCard(page, list.id);
  await expect
    .poll(() => subItemNames(searchCard, parent.id))
    .toEqual(["Палатка", "Спальник"]);
  // Кнопки сворачивания при поиске нет: нажатие ничего не изменило бы на экране.
  await expect(
    ownControl(searchCard, parent.id, "sub-items-toggle"),
  ).toHaveCount(0);
  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([parent.id]);

  // Поиск закончился — блок снова свёрнут.
  await visible(page, "search-input").fill("");
  await expect(
    itemRow(listCard(page, list.id), parent.id).getByTestId("sub-items"),
  ).toHaveCount(0);
});

test("добавление подпункта раскрывает свёрнутый блок", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent] = await makeItems(db, list.id, ["Ужин"]);
  await makeSubItems(db, list.id, parent.id, ["Купить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await ownControl(card, parent.id, "sub-items-toggle").click();
  await expect(itemRow(card, parent.id).getByTestId("sub-items")).toHaveCount(0);

  const menu = await openItemMenu(card, parent.id);
  await menu.getByTestId("item-add-sub-item").click();

  // Иначе поле ввода оказалось бы спрятано вместе с подпунктами.
  await expect(itemRow(card, parent.id).getByTestId("add-sub-item-input")).toBeVisible();
  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([]);
});

test("ID удалённых записей убираются из хранилища", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const [parent, other] = await makeItems(db, list.id, ["Ужин", "Уборка"]);
  await makeSubItems(db, list.id, parent.id, ["Купить"]);
  await makeSubItems(db, list.id, other.id, ["Пропылесосить"]);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await ownControl(card, parent.id, "sub-items-toggle").click();
  await ownControl(card, other.id, "sub-items-toggle").click();
  expect((await collapsedIds(page, user.defaultSpaceId)).sort()).toEqual(
    [parent.id, other.id].sort(),
  );

  // Записей сильно больше, чем списков, поэтому без уборки набор рос бы
  // быстрее всего именно здесь.
  const menu = await openItemMenu(card, other.id);
  await menu.getByTestId("item-delete").click();
  await visible(page, "item-delete-modal").getByTestId("item-delete-confirm").click();

  await expect
    .poll(() => collapsedIds(page, user.defaultSpaceId))
    .toEqual([parent.id]);
});
