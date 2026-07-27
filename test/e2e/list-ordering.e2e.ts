/**
 * @file list-ordering.e2e.ts
 * @description Персональный порядок карточек внутри групп и drop на вкладку.
 *
 * Здесь проверяется связка плоского порядка с раскладкой из последовательных
 * колонок: жест пересекает границу колонок, но в БД меняется membership одной
 * группы, а назначение в другую группу не удаляет исходную.
 */

import { expect, test } from "./fixtures";
import { makeList } from "./factories";
import {
  dragListOnto,
  dragListToGroup,
  listCard,
  listTitles,
  openSpace,
  visible,
} from "./helpers";

test("карточки перетаскиваются между колонками и сохраняют порядок группы", async ({
  page,
  user,
  db,
}) => {
  await page.setViewportSize({ width: 1360, height: 1000 });
  const group = await db.listGroup.create({
    data: {
      userId: user.id,
      spaceId: user.defaultSpaceId,
      name: "Работа",
      position: 1,
    },
  });
  const lists: Awaited<ReturnType<typeof makeList>>[] = [];
  for (const title of ["A", "B", "C", "D", "E", "F", "G"]) {
    lists.push(
      await makeList(db, user.id, user.defaultSpaceId, { title }),
    );
  }
  await db.listGroupMembership.createMany({
    data: lists.map((list, index) => ({
      groupId: group.id,
      listId: list.id,
      position: index + 1,
    })),
  });

  await openSpace(page, user);
  await expect(page.getByTestId("list-drag-handle")).toHaveCount(0);
  await page
    .locator(
      `[data-testid="group-chip"][data-group-id="${group.id}"]:visible`,
    )
    .click();
  await expect(
    page.locator(
      `[data-testid="lists-group-view"][data-group-id="${group.id}"]`,
    ),
  ).toBeVisible();
  await expect(page.getByTestId("list-drag-handle")).toHaveCount(lists.length);
  await expect(page.getByTestId("lists-column")).toHaveCount(3);
  await expect.poll(() => listTitles(page)).toEqual([
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
  ]);

  await dragListOnto(page, lists[6].id, lists[0].id, async () => {
    const draggedSource = page.locator(
      `[data-testid="list-sortable"][data-list-id="${lists[6].id}"]`,
    );
    await expect(draggedSource).toHaveAttribute(
      "data-drag-projection",
      "hidden",
    );
    await expect(draggedSource).toHaveCSS("opacity", "0");
  });

  const firstExpected = ["G", "A", "B", "C", "D", "E", "F"];
  // Server Action ещё может сохранять порядок, но ручки не должны исчезать и
  // сдвигать заголовки карточек: на это время они остаются disabled.
  await expect(page.getByTestId("list-drag-handle")).toHaveCount(lists.length);
  await expect.poll(() => listTitles(page)).toEqual(firstExpected);
  await expect(
    listCard(page, lists[6].id).getByTestId("list-drag-handle"),
  ).toBeEnabled();

  // G уходит с вершины первой колонки во вторую. Пока его старая копия
  // доигрывает exit-анимацию, она не должна занимать место и сдвигать A вниз.
  await dragListOnto(
    page,
    lists[6].id,
    lists[3].id,
    undefined,
    async () => {
      await expect(
        page.locator(
          `[data-testid="list-sortable"][data-list-id="${lists[6].id}"]`,
        ),
      ).toHaveCount(2);
      const [columnBox, firstCardBox] = await Promise.all([
        page.getByTestId("lists-column").first().boundingBox(),
        page
          .locator(
            `[data-testid="list-sortable"][data-list-id="${lists[0].id}"]`,
          )
          .boundingBox(),
      ]);
      if (!columnBox || !firstCardBox) {
        throw new Error("Не удалось измерить раскладку после межколоночного drop");
      }
      expect(Math.abs(firstCardBox.y - columnBox.y)).toBeLessThan(2);
    },
  );

  const expected = ["A", "B", "C", "D", "G", "E", "F"];
  await expect.poll(() => listTitles(page)).toEqual(expected);
  await page.reload();
  await expect.poll(() => listTitles(page)).toEqual(expected);
});

test("drop на вкладку добавляет в конец и сохраняет исходную группу", async ({
  page,
  user,
  db,
}) => {
  const [source, target] = await Promise.all(
    ["Исходная", "Целевая"].map((name, index) =>
      db.listGroup.create({
        data: {
          userId: user.id,
          spaceId: user.defaultSpaceId,
          name,
          position: index + 1,
        },
      }),
    ),
  );
  const existing = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Уже в цели",
  });
  const moving = await makeList(db, user.id, user.defaultSpaceId, {
    title: "Перетаскиваемый",
  });
  await db.listGroupMembership.createMany({
    data: [
      { groupId: source.id, listId: moving.id, position: 1 },
      { groupId: target.id, listId: existing.id, position: 1 },
    ],
  });

  await openSpace(page, user);
  await page
    .locator(
      `[data-testid="group-chip"][data-group-id="${source.id}"]:visible`,
    )
    .click();
  await dragListToGroup(page, moving.id, target.id);

  await expect(listCard(page, moving.id)).toBeVisible();
  await expect
    .poll(() =>
      db.listGroupMembership.count({ where: { listId: moving.id } }),
    )
    .toBe(2);
  const memberships = await db.listGroupMembership.findMany({
    where: { listId: moving.id },
    select: { groupId: true },
  });
  expect(memberships.map((membership) => membership.groupId).sort()).toEqual(
    [source.id, target.id].sort(),
  );

  await page
    .locator(
      `[data-testid="group-chip"][data-group-id="${target.id}"]:visible`,
    )
    .click();
  await expect.poll(() => listTitles(page)).toEqual([
    "Уже в цели",
    "Перетаскиваемый",
  ]);
});

test("меню меняет тот же плоский порядок, а поиск скрывает DnD", async ({
  page,
  user,
  db,
}) => {
  const group = await db.listGroup.create({
    data: {
      userId: user.id,
      spaceId: user.defaultSpaceId,
      name: "Меню",
      position: 1,
    },
  });
  const first = await makeList(db, user.id, user.defaultSpaceId, { title: "A" });
  const second = await makeList(db, user.id, user.defaultSpaceId, { title: "B" });
  await db.listGroupMembership.createMany({
    data: [
      { groupId: group.id, listId: first.id, position: 1 },
      { groupId: group.id, listId: second.id, position: 2 },
    ],
  });

  await openSpace(page, user);
  await page
    .locator(
      `[data-testid="group-chip"][data-group-id="${group.id}"]:visible`,
    )
    .click();
  await expect(
    page.locator(
      `[data-testid="lists-group-view"][data-group-id="${group.id}"]`,
    ),
  ).toBeVisible();
  await listCard(page, second.id).getByTestId("list-menu-trigger").click();
  await visible(page, "list-move-earlier").click();
  await expect.poll(() => listTitles(page)).toEqual(["B", "A"]);

  await page.getByTestId("tab-search").click();
  await page.getByTestId("search-input").fill("B");
  await expect(listCard(page, second.id).getByTestId("list-drag-handle")).toHaveCount(
    0,
  );
});
