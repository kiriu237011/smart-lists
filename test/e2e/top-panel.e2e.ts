/**
 * @file top-panel.e2e.ts
 * @description Сворачивание верхней панели создания и поиска.
 *
 * Свёрнутость панели — персональная настройка отображения на устройство: она
 * живёт в localStorage этого браузера и в БД не попадает. Поэтому проверяется
 * ровно две вещи — что видно на экране и что осталось в хранилище после
 * перезагрузки.
 */

import { expect, test } from "./fixtures";
import { makeList } from "./factories";
import { listCard, localStorageItem, openSpace, visible } from "./helpers";

/** Ключ хранилища: панель одна на все пространства, как и активная вкладка. */
const STORAGE_KEY = "topPanel";

test("панель сворачивается и переживает перезагрузку", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Продукты",
  });

  await openSpace(page, user);

  // По умолчанию панель раскрыта, и в хранилище о ней ничего нет.
  await expect(visible(page, "top-panel-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(await localStorageItem(page, STORAGE_KEY)).toBeNull();

  await visible(page, "top-panel-toggle").click();

  // Уходит содержимое, вкладки и сами списки остаются на месте.
  await expect(page.getByTestId("create-list-form")).toBeHidden();
  await expect(visible(page, "tab-create")).toBeVisible();
  await expect(listCard(page, list.id)).toBeVisible();
  expect(await localStorageItem(page, STORAGE_KEY)).toBe("collapsed");

  await page.reload();
  await expect(visible(page, "top-panel-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.getByTestId("create-list-form")).toBeHidden();

  // Обратное действие возвращает форму и обновляет хранилище.
  await visible(page, "top-panel-toggle").click();
  await expect(visible(page, "create-list-form")).toBeVisible();
  expect(await localStorageItem(page, STORAGE_KEY)).toBe("expanded");
});

test("клик по вкладке раскрывает свёрнутую панель", async ({
  page,
  user,
  db,
}) => {
  // Вкладки видны и в свёрнутом виде, поэтому клик по ним обязан что-то
  // показывать: иначе переключение выглядит как сломанная кнопка.
  await makeList(db, user.id, user.defaultSpaceId, { title: "Продукты" });

  await openSpace(page, user);
  await visible(page, "top-panel-toggle").click();
  await expect(page.getByTestId("create-list-form")).toBeHidden();

  await visible(page, "tab-search").click();

  await expect(visible(page, "search-input")).toBeVisible();
  await expect(visible(page, "top-panel-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(await localStorageItem(page, STORAGE_KEY)).toBe("expanded");

  // Поле получило фокус при раскрытии — набирать можно сразу.
  await expect(visible(page, "search-input")).toBeFocused();
  await visible(page, "search-input").fill("Прод");
  await expect(visible(page, "search-results")).toHaveText(
    "Search results: 1 of 1",
  );
});

test("свёрнутая панель не мешает создать список", async ({
  page,
  user,
  db,
}) => {
  // Свёрнутость касается только панели: остальной интерфейс продолжает
  // работать, и раскрытие возвращает рабочую форму, а не её снимок.
  await makeList(db, user.id, user.defaultSpaceId, { title: "Старый" });

  await openSpace(page, user);
  await visible(page, "top-panel-toggle").click();
  await expect(page.getByTestId("create-list-form")).toBeHidden();

  await visible(page, "top-panel-toggle").click();
  await visible(page, "create-list-input").fill("Новый");
  await visible(page, "create-list-submit").click();

  await expect
    .poll(() => visible(page, "list-title").filter({ hasText: "Новый" }).count())
    .toBe(1);
});
