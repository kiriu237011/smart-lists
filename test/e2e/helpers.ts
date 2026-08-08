/**
 * @file helpers.ts
 * @description Общие действия и локаторы для спек.
 *
 * Селекторы держатся на `data-testid`, а не на тексте: интерфейс переводится
 * на четыре языка, и тест, опирающийся на подпись, ломается при правке перевода,
 * а не при изменении поведения.
 */

import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import type { E2EUser } from "./factories";

/**
 * Видимый элемент по `data-testid`.
 *
 * Обычный `getByTestId` здесь не годится: на время переходов и анимаций в DOM
 * остаётся скрытая копия поддерева (AnimatePresence держит уходящий узел,
 * Suspense — предыдущий сегмент), и strict mode засчитывает её вторым
 * совпадением. Фильтр по видимости оставляет ровно тот узел, который видит
 * пользователь, а автоожидание Playwright переживает момент, когда видимого
 * узла нет вовсе.
 */
export function visible(scope: Page | Locator, testId: string): Locator {
  return scope.locator(`[data-testid="${testId}"]:visible`);
}

/** Открывает пространство пользователя (по умолчанию — default). */
export async function openSpace(
  page: Page,
  user: E2EUser,
  spaceId?: string,
): Promise<void> {
  await page.goto(`/en/spaces/${spaceId ?? user.defaultSpaceId}`);
  // Ждём гидратацию: до неё клики по кнопкам ничего не делают.
  await expect(visible(page, "create-list-form")).toBeVisible();
}

/** Карточка конкретного списка. */
export function listCard(page: Page, listId: string): Locator {
  return page.locator(
    `[data-testid="list-card"][data-list-id="${listId}"]:visible`,
  );
}

/** Единственная карточка на странице — для тестов, создающих ровно один список. */
export function onlyListCard(page: Page): Locator {
  return visible(page, "list-card");
}

/** Строка записи внутри карточки. */
export function itemRow(card: Locator, itemId: string): Locator {
  return card.locator(`[data-testid="item"][data-item-id="${itemId}"]`);
}

/** Названия записей в порядке отображения. */
export async function itemNames(card: Locator): Promise<string[]> {
  return card.getByTestId("item-name").allInnerTexts();
}

/**
 * Создаёт список через интерфейс и ждёт, когда карточка останется в одном
 * экземпляре.
 *
 * Ждём именно единицу, а не «хотя бы одну»: пока идёт создание, на экране
 * рядом живут оптимистичная временная карточка и пришедшая с сервера. Если
 * временная не будет заменена, список так и останется задвоенным — проверка
 * на видимость этого не заметила бы.
 */
export async function createList(page: Page, title: string): Promise<void> {
  await visible(page, "create-list-input").fill(title);
  await visible(page, "create-list-submit").click();
  await expect
    .poll(() => visible(page, "list-title").filter({ hasText: title }).count())
    .toBe(1);
}

/** Добавляет запись в список и ждёт её появления. */
export async function addItem(card: Locator, name: string): Promise<void> {
  await card.getByTestId("add-item-input").fill(name);
  await card.getByTestId("add-item-submit").click();
  await expect(card.getByTestId("item-name").filter({ hasText: name })).toBeVisible();
}

/** Открывает меню действий записи. */
export async function openItemMenu(card: Locator, itemId: string): Promise<Locator> {
  const row = itemRow(card, itemId);
  // Меню подпункта живёт внутри строки родителя, поэтому у пункта совпадений
  // было бы два — своё и вложенное. Берём ближайшее к самой строке.
  await row.getByTestId("item-menu-trigger").first().click();
  const menu = row.getByTestId("item-menu").first();
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * Собственный элемент строки пункта.
 *
 * Подпункты лежат внутри строки родителя и используют те же `data-testid`,
 * поэтому у пункта с подпунктами совпадений несколько. Разметка родителя идёт
 * первой, так что `first()` — это ровно его собственный элемент.
 */
export function ownControl(
  card: Locator,
  itemId: string,
  testId: string,
): Locator {
  return itemRow(card, itemId).getByTestId(testId).first();
}

/**
 * Строка подпункта. Отличается от `itemRow` по testid: пункты верхнего уровня
 * остаются `item`, поэтому подсчёт записей в старых тестах не сбивается.
 */
export function subItemRow(card: Locator, itemId: string): Locator {
  return card.locator(`[data-testid="sub-item"][data-item-id="${itemId}"]`);
}

/** Названия подпунктов конкретного пункта в порядке отображения. */
export async function subItemNames(
  card: Locator,
  parentId: string,
): Promise<string[]> {
  return itemRow(card, parentId)
    .getByTestId("sub-item")
    .getByTestId("item-name")
    .allInnerTexts();
}

/**
 * Добавляет подпункт через меню пункта и ждёт, когда он сохранится.
 *
 * Ждать появления названия недостаточно: оптимистичная строка возникает
 * мгновенно, ещё до ответа сервера, и следующее действие теста работало бы с
 * недосохранённым состоянием. Признак завершения — исчезновение временного ID.
 */
export async function addSubItem(
  card: Locator,
  parentId: string,
  name: string,
): Promise<void> {
  const row = itemRow(card, parentId);
  const menu = await openItemMenu(card, parentId);
  await menu.getByTestId("item-add-sub-item").click();
  await row.getByTestId("add-sub-item-input").fill(name);
  await row.getByTestId("add-sub-item-submit").click();
  await expect(
    row.getByTestId("sub-item").getByTestId("item-name").filter({ hasText: name }),
  ).toBeVisible();
  await expect(row.locator('[data-item-id^="temp-"]')).toHaveCount(0);
}

/** Открывает меню действий списка. */
export async function openListMenu(card: Locator): Promise<Locator> {
  await card.getByTestId("list-menu-trigger").click();
  const menu = card.getByTestId("list-menu");
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * Перетаскивает запись за ручку на место другой записи.
 *
 * Жест выполняется реальными событиями мыши: Reorder из framer-motion слушает
 * pointer-события, и синтетический `dragTo` его не запускает. Первое короткое
 * движение нужно, чтобы жест распознался как перетаскивание, а не как клик.
 */
export async function dragItemOnto(
  page: Page,
  card: Locator,
  sourceItemId: string,
  targetItemId: string,
): Promise<void> {
  await dragRowOnto(
    page,
    itemRow(card, sourceItemId),
    itemRow(card, targetItemId),
  );
}

/**
 * Перетаскивает подпункт на место другого подпункта.
 *
 * Отдельно от `dragItemOnto`, потому что строки подпунктов помечены другим
 * `data-testid` и лежат внутри строки родителя: тот же локатор нашёл бы и
 * пункт, и его подпункты.
 */
export async function dragSubItemOnto(
  page: Page,
  card: Locator,
  sourceItemId: string,
  targetItemId: string,
): Promise<void> {
  await dragRowOnto(
    page,
    subItemRow(card, sourceItemId),
    subItemRow(card, targetItemId),
  );
}

/** Общая механика жеста: ручка строки-источника едет на строку-получателя. */
async function dragRowOnto(
  page: Page,
  sourceRow: Locator,
  targetRow: Locator,
): Promise<void> {
  // Ручки подпунктов лежат внутри строки родителя, поэтому берём первую —
  // она принадлежит самой строке.
  const handle = sourceRow.getByTestId("item-drag-handle").first();
  const handleBox = await handle.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!handleBox || !targetBox) {
    throw new Error("Не удалось получить геометрию строк для перетаскивания");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  // Целимся за середину строки-получателя: Reorder меняет порядок, когда
  // перетаскиваемая строка перекрывает соседнюю больше чем наполовину.
  const endY =
    targetBox.y + (targetBox.y < startY ? 2 : targetBox.height - 2);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + (endY > startY ? 6 : -6), { steps: 3 });
  await page.mouse.move(startX, endY, { steps: 20 });
  await page.mouse.up();
}

/** Названия пользовательских групп в текущем визуальном порядке. */
export async function groupNames(page: Page): Promise<string[]> {
  return page.locator('[data-testid="group-chip"]:visible').allTextContents();
}

/**
 * Перетаскивает группу за отдельную ручку на место другой группы.
 * Реальные pointer-события нужны и dnd-kit, как Framer Motion у записей.
 */
export async function dragGroupOnto(
  page: Page,
  sourceGroupId: string,
  targetGroupId: string,
  beforeDrop?: () => Promise<void>,
): Promise<void> {
  const source = page.locator(
    `[data-testid="group-sortable"][data-group-id="${sourceGroupId}"]:visible`,
  );
  const target = page.locator(
    `[data-testid="group-sortable"][data-group-id="${targetGroupId}"]:visible`,
  );
  const sourceBox = await source.boundingBox();
  const handleBox = await source.getByTestId("group-drag-handle").boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !handleBox || !targetBox) {
    throw new Error("Не удалось получить геометрию групп для перетаскивания");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const pointerOffsetX = sourceBox.x + sourceBox.width / 2 - startX;
  const pointerOffsetY = sourceBox.y + sourceBox.height / 2 - startY;
  const endX = targetBox.x + targetBox.width / 2 - pointerOffsetX;
  const endY = targetBox.y + targetBox.height / 2 - pointerOffsetY;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + (endX >= startX ? 8 : -8), startY, {
    steps: 3,
  });
  await page.mouse.move(endX, endY, { steps: 24 });
  await beforeDrop?.();
  await page.mouse.up();
}

/** Заголовки видимых карточек в каноническом DOM-порядке колонок. */
export async function listTitles(page: Page): Promise<string[]> {
  return page
    .locator('[data-testid="list-card"]:visible [data-testid="list-title"]')
    .allTextContents();
}

/** Перетаскивает карточку за ручку на место другой карточки. */
export async function dragListOnto(
  page: Page,
  sourceListId: string,
  targetListId: string,
  onDragStarted?: () => Promise<void>,
  onDropped?: () => Promise<void>,
): Promise<void> {
  const source = page.locator(
    `[data-testid="list-sortable"][data-list-id="${sourceListId}"]:visible`,
  );
  const target = page.locator(
    `[data-testid="list-sortable"][data-list-id="${targetListId}"]:visible`,
  );
  const sourceBox = await source.boundingBox();
  const handleBox = await source.getByTestId("list-drag-handle").boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !handleBox || !targetBox) {
    throw new Error("Не удалось получить геометрию карточек для перетаскивания");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const pointerOffsetX = sourceBox.x + sourceBox.width / 2 - startX;
  const pointerOffsetY = sourceBox.y + sourceBox.height / 2 - startY;
  const endX = targetBox.x + targetBox.width / 2 - pointerOffsetX;
  const endY = targetBox.y + targetBox.height / 2 - pointerOffsetY;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + (endX >= startX ? 8 : -8), startY, {
    steps: 3,
  });
  await onDragStarted?.();
  await page.mouse.move(endX, endY, { steps: 24 });
  await page.mouse.up();
  await onDropped?.();
}

/** Бросает карточку на вкладку группы, не удаляя исходные membership. */
export async function dragListToGroup(
  page: Page,
  listId: string,
  groupId: string,
): Promise<void> {
  const source = page.locator(
    `[data-testid="list-sortable"][data-list-id="${listId}"]:visible`,
  );
  const target = page.locator(
    `[data-testid="group-sortable"][data-group-id="${groupId}"]:visible`,
  );
  const handleBox = await source.getByTestId("list-drag-handle").boundingBox();
  const targetBox = await target.boundingBox();
  if (!handleBox || !targetBox) {
    throw new Error("Не удалось получить геометрию списка и целевой группы");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - 8, { steps: 3 });
  await page.mouse.move(endX, endY, { steps: 24 });
  await page.mouse.up();
}

/** Значение ключа localStorage текущей страницы. */
export async function localStorageItem(
  page: Page,
  key: string,
): Promise<string | null> {
  return page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
}
