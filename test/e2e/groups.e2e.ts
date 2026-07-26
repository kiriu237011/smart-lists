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
import {
  dragGroupOnto,
  groupNames,
  listCard,
  localStorageItem,
  openSpace,
  visible,
} from "./helpers";

test("группы перетаскиваются между строками и задают порядок меню", async ({
  page,
  user,
  db,
}) => {
  await page.setViewportSize({ width: 460, height: 900 });
  const names = [
    "Личное",
    "Работа",
    "Покупки",
    "Путешествия",
    "Архив документов",
    "Когда-нибудь",
  ];
  const groups = await Promise.all(
    names.map((name, index) =>
      db.listGroup.create({
        data: {
          name,
          userId: user.id,
          spaceId: user.defaultSpaceId,
          position: index + 1,
        },
      }),
    ),
  );
  const list = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Проверка порядка",
  });

  await page.emulateMedia({ colorScheme: "dark" });
  await openSpace(page, user);
  const firstBox = await page
    .locator(
      `[data-testid="group-sortable"][data-group-id="${groups[0].id}"]:visible`,
    )
    .boundingBox();
  const lastBox = await page
    .locator(
      `[data-testid="group-sortable"][data-group-id="${groups[5].id}"]:visible`,
    )
    .boundingBox();
  expect(firstBox).not.toBeNull();
  expect(lastBox).not.toBeNull();
  expect(lastBox!.y).toBeGreaterThan(firstBox!.y);

  // Ручка доступна только у активной группы, как и кнопка удаления.
  await expect(page.getByTestId("group-drag-handle")).toHaveCount(0);
  await page
    .locator(
      `[data-testid="group-chip"][data-group-id="${groups[5].id}"]:visible`,
    )
    .click();
  await expect(page.getByTestId("group-drag-handle")).toHaveCount(1);
  await expect(
    page
      .locator(
        `[data-testid="group-sortable"][data-group-id="${groups[5].id}"]:visible`,
      )
      .getByTestId("group-drag-handle"),
  ).toBeVisible();
  const activeChip = page.locator(
    `[data-testid="group-chip"][data-group-id="${groups[5].id}"]:visible`,
  );
  await expect(activeChip).toHaveClass(/dark:peer-hover\/drag:bg-zinc-700/);
  const restingBackground = await activeChip.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.getByTestId("group-drag-handle").hover();
  await expect
    .poll(() =>
      activeChip.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      ),
    )
    .not.toBe(restingBackground);

  await dragGroupOnto(page, groups[5].id, groups[2].id, async () => {
    const stationaryBoxes = await page
      .locator(
        `[data-testid="group-sortable"]:visible:not([data-group-id="${groups[5].id}"])`,
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
          };
        }),
      );

    const overlaps: Array<[number, number]> = [];
    for (let leftIndex = 0; leftIndex < stationaryBoxes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < stationaryBoxes.length;
        rightIndex += 1
      ) {
        const left = stationaryBoxes[leftIndex];
        const right = stationaryBoxes[rightIndex];
        const overlapsHorizontally =
          Math.max(left.left, right.left) <
          Math.min(left.right, right.right) - 0.5;
        const overlapsVertically =
          Math.max(left.top, right.top) <
          Math.min(left.bottom, right.bottom) - 0.5;
        if (overlapsHorizontally && overlapsVertically) {
          overlaps.push([leftIndex, rightIndex]);
        }
      }
    }

    expect(overlaps).toEqual([]);
  });
  const expected = [
    names[0],
    names[1],
    names[5],
    names[2],
    names[3],
    names[4],
  ];
  await expect.poll(() => groupNames(page)).toEqual(expected);

  await expect
    .poll(async () => {
      const stored = await db.listGroup.findMany({
        where: { userId: user.id, spaceId: user.defaultSpaceId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { name: true },
      });
      return stored.map((group) => group.name);
    })
    .toEqual(expected);

  // Ждём именно завершения Server Action/RSC-ответа: если открыть меню раньше,
  // пришедший payload закономерно перемонтирует карточку и закроет dropdown.
  await expect(
    page.locator(
      `[data-testid="group-sortable"][data-group-id="${groups[5].id}"]:visible`,
    ).getByTestId("group-drag-handle"),
  ).toBeEnabled();

  // Меню назначения получает тот же канонический массив групп.
  await visible(page, "group-all").click();
  const card = listCard(page, list.id);
  await card.getByTestId("list-group-trigger").click();
  await expect
    .poll(() => card.getByTestId("list-group-option").allTextContents())
    .toEqual(expected);

  await page.reload();
  await expect.poll(() => groupNames(page)).toEqual(expected);
  await expect(visible(page, "group-all")).toBeVisible();
});

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
  const groupOption = card
    .getByTestId("list-group-option")
    .filter({ hasText: "Дом" });
  await groupOption.click();
  // Меню закрывается только после ответа операции. Так проверка не принимает
  // текст самой ещё открытой опции за уже применённый бейдж группы.
  await expect(groupOption).toHaveCount(0);
  await expect(card.getByTestId("list-group-trigger")).toContainText("Дом");

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
    data: {
      name: "Дом",
      userId: user.id,
      spaceId: user.defaultSpaceId,
      position: 1,
    },
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
    data: {
      name: "Временная",
      userId: user.id,
      spaceId: user.defaultSpaceId,
      position: 1,
    },
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
