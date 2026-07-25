/**
 * @file collapse.e2e.ts
 * @description Сворачивание карточки списка.
 *
 * Свёрнутость — персональная настройка отображения: она живёт в localStorage
 * этого браузера и в БД не попадает. Поэтому проверяется ровно две вещи —
 * что видно на экране и что осталось в хранилище после перезагрузки.
 *
 * Отдельно проверяется стык с поиском: свёрнутая карточка обязана показать
 * найденное, иначе результат поиска нельзя посмотреть, — но сохранённое
 * состояние при этом меняться не должно.
 */

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { makeItems, makeList } from "./factories";
import {
  listCard,
  localStorageItem,
  openListMenu,
  openSpace,
  visible,
} from "./helpers";

/** Ключ хранилища: у авторизованного пользователя он привязан к пространству. */
function storageKey(spaceId: string): string {
  return `collapsedLists:${spaceId}`;
}

/** ID свёрнутых списков из localStorage. */
async function collapsedIds(page: Page, spaceId: string): Promise<string[]> {
  const raw = await localStorageItem(page, storageKey(spaceId));
  return raw ? (JSON.parse(raw) as string[]) : [];
}

test("сворачивание скрывает тело карточки и переживает перезагрузку", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Продукты",
  });
  // Три записи, одна выполнена: при таком наборе счётчик прогресса («1 / 3»)
  // не совпадает с обратным счётом оставшихся, и подмена одного другим видна.
  const [milk] = await makeItems(db, list.id, ["Молоко", "Хлеб", "Сыр"]);
  await db.item.update({ where: { id: milk.id }, data: { isCompleted: true } });

  await openSpace(page, user);
  const card = listCard(page, list.id);
  await expect(card.getByTestId("add-item-input")).toBeVisible();

  await card.getByTestId("list-collapse-toggle").click();

  // Заголовок остаётся, всё остальное уходит.
  await expect(card.getByTestId("list-title")).toBeVisible();
  await expect(card.getByTestId("add-item-input")).toBeHidden();
  await expect(card.getByTestId("item-name").first()).toBeHidden();
  await expect(card).toHaveAttribute("data-collapsed", "true");
  // Сводка показывает прогресс: выполнено одно из трёх.
  await expect(card.getByTestId("list-items-counter")).toHaveText("1 / 3");

  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([list.id]);

  await page.reload();
  await expect(listCard(page, list.id)).toHaveAttribute("data-collapsed", "true");
  await expect(listCard(page, list.id).getByTestId("add-item-input")).toBeHidden();

  // Обратное действие возвращает карточку и очищает хранилище.
  await listCard(page, list.id).getByTestId("list-collapse-toggle").click();
  await expect(listCard(page, list.id).getByTestId("add-item-input")).toBeVisible();
  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([]);

  // Отметка записи двигает счётчик вперёд, а не назад: это прогресс.
  const bread = listCard(page, list.id)
    .getByTestId("item")
    .filter({ hasText: "Хлеб" });
  await bread.getByTestId("item-toggle").click();
  await expect(bread.getByTestId("item-toggle")).toHaveAttribute(
    "data-completed",
    "true",
  );

  await listCard(page, list.id).getByTestId("list-collapse-toggle").click();
  await expect(
    listCard(page, list.id).getByTestId("list-items-counter"),
  ).toHaveText("2 / 3");
});

test("поиск раскрывает свёрнутый список, не меняя сохранённое состояние", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Поездка",
  });
  await makeItems(db, list.id, ["Палатка", "Спальник"]);

  await openSpace(page, user);
  await listCard(page, list.id).getByTestId("list-collapse-toggle").click();
  await expect(listCard(page, list.id)).toHaveAttribute("data-collapsed", "true");

  await visible(page, "tab-search").click();
  await visible(page, "search-input").fill("Палатка");

  // Список найден и показан целиком: результат, на который нельзя посмотреть,
  // бесполезен.
  const card = listCard(page, list.id);
  await expect(card).toHaveAttribute("data-collapsed", "false");
  await expect(card.getByTestId("item-name")).toHaveText(["Палатка"]);
  // Сохранённое состояние поиск не трогает.
  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([list.id]);

  await visible(page, "search-close").click();
  await expect(listCard(page, list.id)).toHaveAttribute("data-collapsed", "true");
  await expect(listCard(page, list.id).getByTestId("add-item-input")).toBeHidden();
});

test("свернуть можно и через меню списка", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Дела",
  });
  await makeItems(db, list.id, ["Позвонить"]);

  await openSpace(page, user);
  const menu = await openListMenu(listCard(page, list.id));
  await menu.getByTestId("list-collapse-menu-item").click();

  await expect(listCard(page, list.id)).toHaveAttribute("data-collapsed", "true");
  expect(await collapsedIds(page, user.defaultSpaceId)).toEqual([list.id]);
});

test("меню свёрнутой карточки не сдвигает раскладку", async ({
  page,
  user,
  db,
}) => {
  // Списки лежат в `columns`-раскладке, а она балансирует колонки по высоте
  // содержимого. Меню, спозиционированное `absolute`, попадало в этот расчёт и
  // выталкивало соседние карточки в другую колонку: у свёрнутой карточки оно
  // выше её самой. Проверяется наблюдаемое следствие — координаты карточек.
  const lists = await Promise.all(
    ["Первый", "Второй", "Третий"].map(async (title) => {
      const list = await makeList(db, user.id, user.defaultSpaceId, { title });
      await makeItems(db, list.id, ["Раз", "Два"]);
      return list;
    }),
  );

  await page.setViewportSize({ width: 1400, height: 900 });
  await openSpace(page, user);

  for (const list of lists) {
    await listCard(page, list.id).getByTestId("list-collapse-toggle").click();
    // Ждём не атрибут, а скрытое тело: атрибут переключается в начале анимации,
    // и мерить раскладку по нему значило бы поймать её на полпути.
    await expect(listCard(page, list.id).getByTestId("add-item-input")).toBeHidden();
  }

  /** Левые границы карточек: по ним видно, что колонка не переехала. */
  const columns = async () =>
    Promise.all(
      lists.map(async (list) => {
        const box = await listCard(page, list.id).boundingBox();
        return box ? Math.round(box.x) : -1;
      }),
    );

  const before = await columns();
  // Три карточки в три колонки — иначе проверка ничего не значит.
  expect(new Set(before).size).toBe(3);

  const card = listCard(page, lists[0].id);
  await card.getByTestId("list-menu-trigger").click();
  await expect(card.getByTestId("list-menu")).toBeVisible();

  expect(await columns()).toEqual(before);
});

test("сворачивание не переставляет карточки между колонками", async ({
  page,
  user,
  db,
}) => {
  // Ради этого свойства раскладка и собрана колонками вручную. В `columns`
  // колонка карточки вычислялась из высот, и сворачивание перебрасывало соседей
  // в другую колонку прямо посреди анимации.
  const lists = await Promise.all(
    Array.from({ length: 9 }, (_, index) => index).map(async (index) => {
      const list = await makeList(db, user.id, user.defaultSpaceId, {
        title: `Список ${index}`,
      });
      await makeItems(
        db,
        list.id,
        Array.from({ length: (index % 4) + 1 }, (_, i) => `Запись ${i}`),
      );
      return list;
    }),
  );

  await page.setViewportSize({ width: 1400, height: 1000 });
  await openSpace(page, user);

  /** Левая граница каждой карточки: по ней видно, в какой она колонке. */
  const columnsOf = async () =>
    Promise.all(
      lists.map(async (list) => {
        const box = await listCard(page, list.id).boundingBox();
        return box ? Math.round(box.x) : -1;
      }),
    );

  const before = await columnsOf();
  // Три колонки — иначе проверка ничего не значит.
  expect(new Set(before).size).toBe(3);

  const first = listCard(page, lists[0].id);
  await first.getByTestId("list-collapse-toggle").click();
  await expect(first.getByTestId("add-item-input")).toBeHidden();

  // Ни одна карточка не сменила колонку: сдвиги допустимы только вертикальные.
  expect(await columnsOf()).toEqual(before);
});

test("меню держится за свою кнопку при прокрутке", async ({ page, user, db }) => {
  // Меню закреплено в координатах окна, поэтому прокрутка обязана его
  // пересчитывать: иначе оно останется висеть посреди экрана.
  for (let index = 0; index < 12; index += 1) {
    const list = await makeList(db, user.id, user.defaultSpaceId, {
      title: `Список ${index}`,
    });
    await makeItems(db, list.id, ["Раз", "Два", "Три"]);
  }

  // Десктопная ширина намеренно: в диапазоне от `md` до `xl` число колонок
  // включается только после гидрации, а ключ по их числу пересоздаёт карточки —
  // открытое в этот момент меню закрылось бы вместе с ними. Проверяем поведение
  // при прокрутке, а не гонку с гидрацией.
  await page.setViewportSize({ width: 1400, height: 600 });
  await openSpace(page, user);

  const card = page.locator('[data-testid="list-card"]:visible').first();
  await card.getByTestId("list-menu-trigger").click();
  await expect(card.getByTestId("list-menu")).toBeVisible();

  /**
   * Зазор между меню и кнопкой с той стороны, где меню оказалось.
   *
   * Сторона намеренно не фиксируется: при прокрутке места снизу может не
   * остаться, и меню перевернётся вверх — это правильное поведение. Проверяется
   * то, что меню осталось прижатым к своей кнопке, а не уехало от неё.
   */
  const gap = async () => {
    const trigger = await card.getByTestId("list-menu-trigger").boundingBox();
    const menu = await card.getByTestId("list-menu").boundingBox();
    if (!trigger || !menu) throw new Error("Меню или кнопка не видны");
    return Math.round(
      menu.y >= trigger.y
        ? menu.y - (trigger.y + trigger.height)
        : trigger.y - (menu.y + menu.height),
    );
  };

  expect(await gap()).toBeLessThanOrEqual(5);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  expect(await gap()).toBeLessThanOrEqual(5);
});

/**
 * Открывает меню единственного списка и возвращает геометрию меню и кнопки.
 *
 * Нужная ситуация создаётся высотой окна, а не прокруткой: кнопка первой
 * карточки стоит на фиксированном расстоянии от верха страницы, поэтому «места
 * снизу хватает» и «не хватает» задаются одним числом. Прокрутка для этого не
 * годится — она упирается в высоту документа и предел прокрутки, отчего тест
 * проверял то один случай, то другой.
 */
async function openMenuAt(
  page: Page,
  viewportHeight: number,
  user: Parameters<typeof openSpace>[1],
) {
  await page.setViewportSize({ width: 420, height: viewportHeight });
  await openSpace(page, user);

  const card = page.locator('[data-testid="list-card"]:visible').first();
  const trigger = card.getByTestId("list-menu-trigger");
  await trigger.click();
  const menu = card.getByTestId("list-menu");
  await expect(menu).toBeVisible();

  const menuBox = await menu.boundingBox();
  const triggerBox = await trigger.boundingBox();
  if (!menuBox || !triggerBox) throw new Error("Нет геометрии");
  return { menuBox, triggerBox };
}

test("меню у нижнего края экрана раскрывается вверх", async ({
  page,
  user,
  db,
}) => {
  // На телефоне меню карточки у нижнего края уходило за границу окна, и достать
  // его было нельзя: при прокрутке оно едет вместе со своей кнопкой.
  await makeList(db, user.id, user.defaultSpaceId, { title: "Единственный" });

  const { menuBox, triggerBox } = await openMenuAt(page, 560, user);

  // Ситуация та самая: под кнопкой меньше места, чем нужно меню.
  const spaceBelow = 560 - (triggerBox.y + triggerBox.height);
  expect(spaceBelow).toBeLessThan(menuBox.height);

  // Меню целиком в пределах окна и раскрылось вверх: его низ выше кнопки.
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(560);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(triggerBox.y + 1);
});

test("при достатке места снизу меню раскрывается вниз", async ({
  page,
  user,
  db,
}) => {
  await makeList(db, user.id, user.defaultSpaceId, { title: "Единственный" });

  // Та же карточка на том же по ширине экране, но высокое окно: переворот
  // должен включаться от нехватки места, а не от узкого экрана.
  const { menuBox, triggerBox } = await openMenuAt(page, 900, user);

  const spaceBelow = 900 - (triggerBox.y + triggerBox.height);
  expect(spaceBelow).toBeGreaterThan(menuBox.height);
  expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
});

test("заметка доступна у свёрнутой карточки, а сворачивание её закрывает", async ({
  page,
  user,
  db,
}) => {
  // Заметка относится к списку целиком, поэтому живёт выше скрытого тела и
  // читается в свёрнутом виде. Но открытой сворачивание её не оставляет: иначе
  // свёрнутая карточка осталась бы высокой и это читалось бы как сбой.
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Продукты",
    note: "Купить молоко и хлеб",
  });
  await makeItems(db, list.id, ["Раз", "Два"]);

  await openSpace(page, user);
  const card = listCard(page, list.id);

  // Открытая заметка закрывается вместе со сворачиванием.
  await card.getByTestId("list-note-toggle").click();
  await expect(card.getByTestId("note-text")).toBeVisible();

  await card.getByTestId("list-collapse-toggle").click();
  await expect(card.getByTestId("add-item-input")).toBeHidden();
  await expect(card.getByTestId("note-text")).toBeHidden();

  // Но у свёрнутой карточки её можно открыть снова — тело остаётся скрытым.
  await card.getByTestId("list-note-toggle").click();
  await expect(card.getByTestId("note-text")).toBeVisible();
  await expect(card.getByTestId("note-text")).toHaveText("Купить молоко и хлеб");
  await expect(card.getByTestId("add-item-input")).toBeHidden();
  await expect(card).toHaveAttribute("data-collapsed", "true");
});

test("свёрнутость не переносится на другой список", async ({
  page,
  user,
  db,
}) => {
  const first = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Первый",
  });
  const second = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Второй",
  });
  await makeItems(db, first.id, ["Раз"]);
  await makeItems(db, second.id, ["Два"]);

  await openSpace(page, user);
  await listCard(page, first.id).getByTestId("list-collapse-toggle").click();

  await expect(listCard(page, first.id)).toHaveAttribute("data-collapsed", "true");
  await expect(listCard(page, second.id)).toHaveAttribute("data-collapsed", "false");
  await expect(listCard(page, second.id).getByTestId("add-item-input")).toBeVisible();
});
