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
  await row.getByTestId("item-menu-trigger").click();
  const menu = row.getByTestId("item-menu");
  await expect(menu).toBeVisible();
  return menu;
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
  const handle = itemRow(card, sourceItemId).getByTestId("item-drag-handle");
  const handleBox = await handle.boundingBox();
  const targetBox = await itemRow(card, targetItemId).boundingBox();
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

/** Значение ключа localStorage текущей страницы. */
export async function localStorageItem(
  page: Page,
  key: string,
): Promise<string | null> {
  return page.evaluate((storageKey) => localStorage.getItem(storageKey), key);
}
