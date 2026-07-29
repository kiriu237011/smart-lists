/**
 * @file sharing.e2e.ts
 * @description Совместный доступ глазами двух пользователей.
 *
 * Интеграционные тесты проверяют, что Action откажет редактору в чужой
 * операции. Здесь проверяется другое: что редактор этих операций вообще не
 * видит. Кнопка, которую не должно быть видно, но которая есть, — это не отказ
 * сервера, а недоразумение в интерфейсе.
 */

import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { PrismaClient } from "@/generated/prisma/client";

import { expect, signInAs, test } from "./fixtures";
import { makeItems, makeList, makeUser, type E2EUser } from "./factories";
import { addItem, itemNames, listCard, openListMenu, openSpace, visible } from "./helpers";

/**
 * Второй браузерный контекст под другим пользователем.
 *
 * Именно контекст, а не вкладка: у второго пользователя своя cookie сессии, а
 * в одном контексте они бы затирали друг друга.
 */
async function openAs(
  browser: Browser,
  db: PrismaClient,
  recipient: E2EUser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "en-US" });
  await signInAs(context, db, recipient);
  const page = await context.newPage();
  return { context, page };
}

test("получатель видит список и может менять содержимое, но не владеть им", async ({
  page,
  user,
  db,
  browser,
}) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Общий список",
  });
  await makeItems(db, list.id, ["Молоко"]);
  const editor = await makeUser(db, { name: "Редактор" });

  await openSpace(page, user);

  // Владелец приглашает по email.
  const ownerCard = listCard(page, list.id);
  await ownerCard.getByTestId("share-toggle").click();
  await ownerCard.getByTestId("share-email-input").fill(editor.email);
  await ownerCard.getByTestId("share-invite-submit").click();
  await expect(
    ownerCard.locator(`[data-testid="share-member"][data-member-email="${editor.email}"]`),
  ).toBeVisible();

  const { context, page: editorPage } = await openAs(browser, db, editor);
  try {
    await openSpace(editorPage, editor);

    // Список размещён в default-пространстве получателя и помечен как чужой.
    const editorCard = listCard(editorPage, list.id);
    await expect(editorCard).toHaveAttribute("data-list-role", "editor");
    await expect(editorCard).toContainText("Owner:");

    // Управление доступом и удаление списка редактору недоступны.
    await expect(editorCard.getByTestId("share-toggle")).toHaveCount(0);
    const menu = await openListMenu(editorCard);
    await expect(menu.getByTestId("list-delete")).toHaveCount(0);
    await editorPage.keyboard.press("Escape");

    // Содержимое редактор менять может.
    await addItem(editorCard, "Хлеб");
    await expect.poll(() => itemNames(editorCard)).toEqual(["Молоко", "Хлеб"]);

    // Владелец видит правку после обновления страницы.
    await page.reload();
    await expect.poll(() => itemNames(listCard(page, list.id))).toEqual([
      "Молоко",
      "Хлеб",
    ]);

    // Фильтр по listId обязателен: тесты идут параллельно против одной базы, и
    // запись с тем же названием может принадлежать чужому списку.
    const stored = await db.item.findFirstOrThrow({
      where: { listId: list.id, name: "Хлеб" },
    });
    expect(stored.addedById).toBe(editor.id);
  } finally {
    await context.close();
  }
});

test("владелец отзывает доступ", async ({ page, user, db, browser }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Ненадолго общий",
  });
  const editor = await makeUser(db);
  await db.listShare.create({
    data: { listId: list.id, userId: editor.id, spaceId: editor.defaultSpaceId },
  });

  const { context, page: editorPage } = await openAs(browser, db, editor);
  try {
    await openSpace(editorPage, editor);
    await expect(listCard(editorPage, list.id)).toBeVisible();

    await openSpace(page, user);
    const ownerCard = listCard(page, list.id);
    await ownerCard.getByTestId("share-toggle").click();
    await ownerCard.getByTestId("share-member-remove").click();
    await expect(visible(page, "share-remove-modal")).toBeVisible();
    await visible(page, "share-remove-confirm").click();

    await expect
      .poll(() => db.listShare.count({ where: { listId: list.id } }))
      .toBe(0);

    // У бывшего участника список пропадает после обновления.
    await editorPage.reload();
    await expect(listCard(editorPage, list.id)).toHaveCount(0);
    await expect(visible(editorPage, "lists-empty")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("участник выходит из списка сам", async ({ page, user, db, browser }) => {
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Список владельца",
  });
  const editor = await makeUser(db);
  await db.listShare.create({
    data: { listId: list.id, userId: editor.id, spaceId: editor.defaultSpaceId },
  });

  const { context, page: editorPage } = await openAs(browser, db, editor);
  try {
    await openSpace(editorPage, editor);

    await listCard(editorPage, list.id).getByTestId("list-leave").click();
    await expect(visible(editorPage, "confirm-modal")).toBeVisible();
    await visible(editorPage, "confirm-modal-confirm").click();

    await expect(listCard(editorPage, list.id)).toHaveCount(0);
    await expect
      .poll(() => db.listShare.count({ where: { listId: list.id } }))
      .toBe(0);

    // Сам список остаётся у владельца.
    await openSpace(page, user);
    await expect(listCard(page, list.id)).toBeVisible();
  } finally {
    await context.close();
  }
});
