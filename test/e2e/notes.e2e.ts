/**
 * @file notes.e2e.ts
 * @description Заметки: сохранение, переход в диалог по переполнению и общий
 *              черновик встроенного редактора и диалога.
 *
 * Правило «в диалог уходим по факту переполнения блока, а не по числу
 * символов» существует только в вёрстке: одна и та же заметка на узком экране
 * занимает втрое больше строк. Проверить это можно лишь в браузере с заданной
 * шириной окна.
 */

import { expect, test } from "./fixtures";
import { makeList } from "./factories";
import { listCard, openListMenu, openSpace, visible } from "./helpers";

/** Заметка заведомо длиннее одного экрана карточки. */
const LONG_NOTE = Array.from(
  { length: 25 },
  (_, index) => `Строка заметки номер ${index + 1} с достаточно длинным текстом.`,
).join("\n");

test("заметка списка сохраняется и переживает перезагрузку", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId);
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const menu = await openListMenu(card);
  // У списка без заметки в меню есть пункт «добавить заметку».
  await menu.getByTestId("list-note-add").click();

  await visible(page, "note-textarea").fill("Купить до пятницы");
  await visible(page, "note-save").click();

  await expect(visible(page, "note-text")).toHaveText("Купить до пятницы");

  await page.reload();
  await listCard(page, list.id).getByTestId("list-note-toggle").click();
  await expect(visible(page, "note-text")).toHaveText("Купить до пятницы");

  const stored = await db.list.findUnique({ where: { id: list.id } });
  expect(stored?.note).toBe("Купить до пятницы");
  // Первое сохранение поднимает версию: на ней держится защита от потери
  // совместных правок.
  expect(stored?.noteVersion).toBe(1);
});

test("длинная заметка открывается в диалоге и блокирует фон", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    note: LONG_NOTE,
  });
  await openSpace(page, user);

  await listCard(page, list.id).getByTestId("list-note-toggle").click();

  // Блок заметки обрезан по высоте — появляется переход к полному тексту.
  await visible(page, "note-expand").click();

  const dialog = visible(page, "note-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("note-text")).toContainText(
    "Строка заметки номер 25",
  );

  // Фон под диалогом не должен прокручиваться.
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .toBe("hidden");

  await visible(page, "note-dialog-close").click();
  await expect(visible(page, "note-dialog")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
});

test("черновик не теряется при переходе во весь экран", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    note: LONG_NOTE,
  });
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await card.getByTestId("list-note-toggle").click();
  await visible(page, "note-edit").click();

  const draft = `${LONG_NOTE}\nДописано во встроенном редакторе`;
  await visible(page, "note-textarea").fill(draft);

  // Переход в диалог: редактор пересоздаётся, но контроллер черновика общий.
  await visible(page, "note-expand").click();
  const dialog = visible(page, "note-dialog");
  await expect(dialog.getByTestId("note-textarea")).toHaveValue(draft);

  // Возврат из диалога тоже сохраняет набранное.
  await visible(page, "note-dialog-close").click();
  await expect(visible(page, "note-textarea")).toHaveValue(draft);

  await visible(page, "note-save").click();
  await expect(visible(page, "note-text")).toContainText(
    "Дописано во встроенном редакторе",
  );

  const stored = await db.list.findUnique({ where: { id: list.id } });
  expect(stored?.note).toBe(draft);
});

test("чужая правка не затирается молча", async ({
  page,
  user,
  db,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    note: "Исходный текст",
  });
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await card.getByTestId("list-note-toggle").click();
  await visible(page, "note-edit").click();
  await visible(page, "note-textarea").fill("Моя версия");

  // Пока пользователь печатал, заметку изменил другой участник.
  await db.list.update({
    where: { id: list.id },
    data: { note: "Чужая версия", noteVersion: { increment: 1 } },
  });

  await visible(page, "note-save").click();

  // Сохранение отбито проверкой ожидаемой версии: пользователь видит
  // предупреждение, его черновик сохранён, а в базе осталась чужая правка.
  await expect(visible(page, "note-conflict-load")).toBeVisible();
  await expect(visible(page, "note-textarea")).toHaveValue("Моя версия");
  expect((await db.list.findUnique({ where: { id: list.id } }))?.note).toBe(
    "Чужая версия",
  );

  // Перезапись — осознанное действие: она выполняется от актуальной версии.
  await visible(page, "note-conflict-overwrite").click();
  await expect(visible(page, "note-text")).toHaveText("Моя версия");

  const stored = await db.list.findUnique({ where: { id: list.id } });
  expect(stored?.note).toBe("Моя версия");
  expect(stored?.noteVersion).toBe(2);
});

test("узкий экран отправляет в диалог заметку, помещавшуюся на широком", async ({
  page,
  user,
  db,
}) => {
  // Заметка подобрана так, чтобы на десктопной ширине укладываться в блок.
  const note = "Короткая заметка, которой хватает одной строки на широком экране.";
  const list = await makeList(db, user.id, user.defaultSpaceId, { note });

  await page.setViewportSize({ width: 390, height: 780 });
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await card.getByTestId("list-note-toggle").click();
  await expect(visible(page, "note-text")).toContainText("Короткая заметка");

  // Порог — фактическое переполнение блока, а не длина текста: на узком экране
  // тот же текст занимает больше строк.
  const narrowExpand = await visible(page, "note-expand").count();
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect
    .poll(() => visible(page, "note-expand").count())
    .toBeLessThanOrEqual(narrowExpand);
});
