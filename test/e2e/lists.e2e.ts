/**
 * @file lists.e2e.ts
 * @description Жизненный цикл списка через интерфейс.
 *
 * Каждый шаг проверяется дважды: сразу после действия (оптимистичный рендер) и
 * после перезагрузки страницы. Расхождение между ними — самый частый способ
 * сломать связку Action → revalidatePath → RSC payload: на экране всё выглядит
 * правильно, но в базу ничего не легло.
 */

import { expect, test } from "./fixtures";
import { makeList } from "./factories";
import {
  createList,
  listCard,
  onlyListCard,
  openListMenu,
  openSpace,
  visible,
} from "./helpers";

test("созданный список переживает перезагрузку", async ({ page, user, db }) => {
  await openSpace(page, user);

  await createList(page, "Покупки на неделю");

  await page.reload();
  await expect(onlyListCard(page).getByTestId("list-title")).toHaveText(
    "Покупки на неделю",
  );

  // Список привязан к пространству, из которого его создали.
  const stored = await db.list.findFirst({ where: { ownerId: user.id } });
  expect(stored?.spaceId).toBe(user.defaultSpaceId);
});

test("список переименовывается по клику на название", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Старое название",
  });
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await card.getByTestId("list-title").click();
  await card.getByTestId("list-title-input").fill("Новое название");
  await card.getByTestId("list-title-input").press("Enter");

  await expect(card.getByTestId("list-title")).toHaveText("Новое название");

  await page.reload();
  await expect(listCard(page, list.id).getByTestId("list-title")).toHaveText(
    "Новое название",
  );
});

test("Escape отменяет переименование", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Останется как было",
  });
  await openSpace(page, user);

  const card = listCard(page, list.id);
  await card.getByTestId("list-title").click();
  await card.getByTestId("list-title-input").fill("Случайный ввод");
  await card.getByTestId("list-title-input").press("Escape");

  await expect(card.getByTestId("list-title")).toHaveText("Останется как было");

  await page.reload();
  await expect(listCard(page, list.id).getByTestId("list-title")).toHaveText(
    "Останется как было",
  );
});

test("удаление списка требует подтверждения", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Список под удаление",
  });
  await openSpace(page, user);

  const card = listCard(page, list.id);
  const menu = await openListMenu(card);
  await menu.getByTestId("list-delete").click();

  // Отмена оставляет список на месте.
  await expect(visible(page, "confirm-modal")).toBeVisible();
  await visible(page, "confirm-modal-cancel").click();
  await expect(visible(page, "confirm-modal")).toHaveCount(0);
  await expect(card).toBeVisible();

  const menuAgain = await openListMenu(card);
  await menuAgain.getByTestId("list-delete").click();
  await visible(page, "confirm-modal-confirm").click();

  await expect(card).toHaveCount(0);

  await page.reload();
  await expect(listCard(page, list.id)).toHaveCount(0);
  await expect(visible(page, "lists-empty")).toBeVisible();

  expect(await db.list.count({ where: { id: list.id } })).toBe(0);
});

test("списки другого пространства не видны", async ({ page, user, db }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Только в основном",
  });
  const other = await db.space.create({
    data: { userId: user.id, name: "Работа", normalizedName: "работа" },
  });

  await openSpace(page, user, other.id);

  await expect(listCard(page, list.id)).toHaveCount(0);
  await expect(visible(page, "lists-empty")).toBeVisible();
});
