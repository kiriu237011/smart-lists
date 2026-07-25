/**
 * @file groups.e2e.ts
 * @description Группы: создание, назначение списка, фильтр и его память.
 *
 * Активная группа — целиком клиентское состояние в localStorage, привязанное к
 * пространству. Ни один серверный тест не увидит, если ключ перестанет включать
 * `spaceId` и фильтр протечёт между пространствами.
 */

import { expect, test } from "./fixtures";
import { makeList, makeSpace } from "./factories";
import { listCard, localStorageItem, openSpace, visible } from "./helpers";

test("группа создаётся и фильтрует списки", async ({ page, user, db }) => {
  const inGroup = await makeList(db, user.id, user.defaultSpaceId, {
    title: "В группе",
  });
  const outside = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Без группы",
  });
  await openSpace(page, user);

  await visible(page, "group-create-open").click();
  await visible(page, "group-create-input").fill("Дом");
  await visible(page, "group-create-submit").click();

  const chip = page.locator('[data-testid="group-chip"]:visible');
  await expect(chip).toHaveText("Дом");

  // Назначение списка в группу — из меню групп на карточке.
  const card = listCard(page, inGroup.id);
  await card.getByTestId("list-group-trigger").click();
  await card.getByTestId("list-group-option").click();
  await expect(card).toContainText("Дом");

  await chip.click();
  await expect(listCard(page, inGroup.id)).toBeVisible();
  await expect(listCard(page, outside.id)).toHaveCount(0);

  const group = await db.listGroup.findFirstOrThrow({ where: { userId: user.id } });
  expect(group.spaceId).toBe(user.defaultSpaceId);
});

test("активная группа переживает перезагрузку и не течёт в другое пространство", async ({
  page,
  user,
  db,
}) => {
  const second = await makeSpace(db, user.id, "Работа");
  const group = await db.listGroup.create({
    data: { name: "Дом", userId: user.id, spaceId: user.defaultSpaceId },
  });
  const grouped = await makeList(db, user.id, user.defaultSpaceId, {
    title: "В группе",
  });
  await db.list.update({
    where: { id: grouped.id },
    data: { groups: { connect: { id: group.id } } },
  });
  const outside = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Без группы",
  });
  const inSecondSpace = await makeList(db, user.id, second.id, {
    title: "Другое пространство",
  });

  await openSpace(page, user);
  await page.locator(`[data-testid="group-chip"][data-group-id="${group.id}"]`).click();
  await expect(listCard(page, outside.id)).toHaveCount(0);

  await page.reload();
  await expect(listCard(page, grouped.id)).toBeVisible();
  await expect(listCard(page, outside.id)).toHaveCount(0);
  expect(await localStorageItem(page, `activeGroupId:${user.defaultSpaceId}`)).toBe(
    group.id,
  );

  // В другом пространстве фильтр не применяется: ключ включает spaceId.
  await openSpace(page, user, second.id);
  await expect(listCard(page, inSecondSpace.id)).toBeVisible();
  expect(await localStorageItem(page, `activeGroupId:${second.id}`)).toBeNull();
});

test("удаление группы требует подтверждения и не трогает списки", async ({
  page,
  user,
  db,
}) => {
  const group = await db.listGroup.create({
    data: { name: "Временная", userId: user.id, spaceId: user.defaultSpaceId },
  });
  const list = await makeList(db, user.id, user.defaultSpaceId, { title: "Список" });
  await db.list.update({
    where: { id: list.id },
    data: { groups: { connect: { id: group.id } } },
  });

  await openSpace(page, user);
  const chip = page.locator(
    `[data-testid="group-chip"][data-group-id="${group.id}"]`,
  );
  await chip.click();

  // Крестик удаления появляется только у активной группы.
  await page.getByRole("button", { name: `Delete group ${group.name}` }).click();
  await expect(visible(page, "confirm-modal")).toBeVisible();
  await visible(page, "confirm-modal-confirm").click();

  await expect(chip).toHaveCount(0);
  // Список остаётся, фильтр сбрасывается на «Все».
  await expect(listCard(page, list.id)).toBeVisible();

  // Чип исчезает оптимистично, поэтому запись в БД ждём отдельно.
  await expect.poll(() => db.listGroup.count({ where: { id: group.id } })).toBe(0);
  expect(await db.list.count({ where: { id: list.id } })).toBe(1);
});
