/**
 * @file row-layout.e2e.ts
 * @description Раскладка строк списка при изменении их высоты.
 *
 * Высота строки меняется постоянно: раскрылась заметка, заметка ушла в режим
 * редактирования, раскрылся блок подпунктов. У каждого такого изменения было
 * два источника смещений, и оба проверяются здесь.
 *
 *   1. Границы жеста (`dragConstraints`). Получив их в виде ref, framer вешает
 *      ResizeObserver на строку и контейнер и при изменении размеров пишет
 *      строкам x/y, сохраняя их «прогресс» внутри новых границ. Трансформ
 *      залипал навсегда: строки съезжали, а меню записи уезжало вместе со
 *      строкой — элемент с трансформом становится содержащим блоком даже для
 *      `position: fixed`. Границы теперь выдаются только на время жеста.
 *   2. Layout-проекция. Она нужна жесту — соседи разъезжаются пружиной,
 *      показывая, куда встанет запись, — но на изменении высоты удерживает
 *      соседей на старом месте один кадр. Кадр остаётся; обезврежены его
 *      последствия: меню закреплено `fixed`, а фон строки непрозрачен, поэтому
 *      наложение не смешивает два названия в кашу.
 *
 * Проверить это можно только в браузере: речь о вычисленной геометрии и о
 * порядке отрисовки, которых нет ни в разметке, ни в состоянии компонента.
 */

import { expect, test } from "./fixtures";
import { makeItems, makeList, makeSubItems } from "./factories";
import { itemRow, listCard, openSpace } from "./helpers";

/** Заметка на несколько строк: раскрытие заметно меняет высоту строки. */
const LONG_NOTE = Array.from(
  { length: 8 },
  (_, index) => `Строка заметки номер ${index + 1} с достаточно длинным текстом.`,
).join("\n");

/** Узкое окно: названия переносятся, и высоты строк расходятся сильнее. */
test.use({ viewport: { width: 420, height: 1000 } });

/**
 * Точки внутри открытого меню, где верхним элементом оказался кто-то другой,
 * снятые покадрово.
 *
 * Замер идёт по кадрам через `requestAnimationFrame`: перекрытие живёт ровно
 * столько, сколько доигрывает layout-анимация, и одиночная проверка после
 * клика прошла бы мимо него. Сетка точек — по всему меню: перекрытие бывает
 * частичным, и одна проба в центре его пропустила бы.
 */
async function recordMenuCover(
  page: import("@playwright/test").Page,
  action: () => Promise<void>,
): Promise<string[]> {
  await page.evaluate(() => {
    const store: string[] = [];
    (window as unknown as { __cover: string[] }).__cover = store;

    let frames = 0;
    const tick = () => {
      const menu = document.querySelector('[data-testid="item-menu"]');
      if (menu) {
        const box = menu.getBoundingClientRect();
        for (let y = 0.1; y <= 0.9; y += 0.1) {
          for (const x of [0.25, 0.6, 0.9]) {
            const top = document.elementFromPoint(
              box.left + box.width * x,
              box.top + box.height * y,
            );
            if (top && !menu.contains(top)) {
              store.push(
                `${top.tagName}[${top.getAttribute("data-testid") ?? ""}]`,
              );
            }
          }
        }
      }
      if (++frames < 40) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await action();
  // Пружина layout-анимации framer укладывается в этот срок с запасом.
  await page.waitForTimeout(900);

  return page.evaluate(
    () => (window as unknown as { __cover: string[] }).__cover,
  );
}

test("переход заметки в режим редактирования не сдвигает строки", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const items = await makeItems(db, list.id, ["4", "6", "5", "7", "1"]);
  await db.item.update({ where: { id: items[2].id }, data: { note: "123" } });

  await openSpace(page, user);
  const card = listCard(page, list.id);
  await expect(card).toBeVisible();

  // Две смены высоты подряд: сначала раскрывается заметка, потом она уходит в
  // редактор. Именно на второй строки и получали залипший трансформ.
  await itemRow(card, items[2].id).getByTestId("item-note-toggle").first().click();
  await expect(card.getByTestId("note-text")).toBeVisible();
  await card.getByTestId("note-edit").first().click();
  await expect(card.getByTestId("note-textarea")).toBeVisible();
  await page.waitForTimeout(900);

  // Ни одной строки со смещением: трансформ вне жеста не появляется вовсе.
  const shifted = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-item-id]"))
      .map((node) => node.style.transform)
      .filter((transform) => transform && transform !== "none"),
  );
  expect(shifted).toEqual([]);

  // И меню открывается на своём месте у каждой записи: смещённая строка
  // становилась содержащим блоком для `fixed`-меню и уводила его за экран.
  for (const item of items) {
    await itemRow(card, item.id).getByTestId("item-menu-trigger").first().click();
    const placement = await page.evaluate(() => {
      const menu = document.querySelector('[data-testid="item-menu"]');
      if (!menu) return "меню не открылось";
      const box = menu.getBoundingClientRect();
      const top = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      const inViewport = box.top >= 0 && box.bottom <= window.innerHeight;
      return inViewport && top && menu.contains(top) ? "ок" : "меню недоступно";
    });
    expect(placement, `меню записи «${item.name}»`).toBe("ок");
    await page.keyboard.press("Escape");
  }
});

test("открытое меню записи остаётся поверх следующих строк", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const items = await makeItems(db, list.id, [
    "Запись с заметкой",
    "Запись с длинным названием, которое переносится на несколько строк",
    "Запись с подпунктами",
  ]);
  await makeSubItems(db, list.id, items[2].id, ["Первый", "Второй"]);
  await db.item.update({
    where: { id: items[0].id },
    data: { note: LONG_NOTE },
  });

  await openSpace(page, user);
  const card = listCard(page, list.id);
  await expect(card).toBeVisible();

  // Раскрытая заметка первой записи схлопнется при открытии меню: клик по «⋮»
  // закрывает её. Высота строк меняется ровно в тот момент, когда меню
  // появляется на экране, — на этом сочетании меню и уходило под соседей.
  await itemRow(card, items[0].id).getByTestId("item-note-toggle").first().click();
  await expect(card.getByTestId("note-text")).toBeVisible();

  const covered = await recordMenuCover(page, async () => {
    await itemRow(card, items[1].id)
      .getByTestId("item-menu-trigger")
      .first()
      .click();
    await expect(card.getByTestId("item-menu").first()).toBeVisible();
  });

  expect(covered).toEqual([]);
});

test("меню записи у нижнего края окна раскрывается вверх", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  // Записей заведомо больше экрана: тогда страницу есть куда прокручивать, и
  // нужную строку можно подвести вплотную к нижнему краю окна.
  const items = await makeItems(
    db,
    list.id,
    Array.from({ length: 30 }, (_, index) => `Запись ${index + 1}`),
  );

  await openSpace(page, user);
  const card = listCard(page, list.id);
  await expect(card).toBeVisible();

  const row = itemRow(card, items[14].id);
  const trigger = row.getByTestId("item-menu-trigger").first();

  // Ставим строку в 60 пикселях от низа окна: снизу места заведомо не хватит
  // никакому меню, сверху — свободен весь экран. Полагаться на естественное
  // положение последней записи нельзя: под ней идут форма добавления и футер
  // карточки, и места там оказывается достаточно.
  await row.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    window.scrollBy(0, rect.top - (window.innerHeight - 60));
  });

  await trigger.click();
  const menu = card.getByTestId("item-menu").first();
  await expect(menu).toBeVisible();

  const menuBox = (await menu.boundingBox())!;
  const triggerBox = (await trigger.boundingBox())!;
  const viewportHeight = page.viewportSize()!.height;

  // Меню целиком в окне и раскрыто вверх — над своей кнопкой.
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewportHeight);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y + 1);
});

test("фон строки непрозрачен, поэтому наложение не смешивает названия", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  const items = await makeItems(db, list.id, ["Первая", "Вторая"]);

  await openSpace(page, user);
  const card = listCard(page, list.id);
  await expect(card).toBeVisible();

  /** Альфа вычисленного фона строки: 1 — непрозрачный. */
  const rowAlpha = async (itemId: string) =>
    itemRow(card, itemId).evaluate((node) => {
      const color = getComputedStyle(node).backgroundColor;
      const parts = color.match(/[\d.]+/g);
      // rgb(...) без четвёртого компонента — полностью непрозрачный цвет.
      return parts && parts.length === 4 ? Number(parts[3]) : 1;
    });

  expect(await rowAlpha(items[0].id)).toBe(1);

  // Та же гарантия в тёмной теме: именно там строка была прозрачной.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(listCard(page, list.id)).toBeVisible();
  expect(await rowAlpha(items[0].id)).toBe(1);
  expect(await rowAlpha(items[1].id)).toBe(1);
});
