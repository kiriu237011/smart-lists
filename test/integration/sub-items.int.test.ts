/**
 * @file sub-items.int.test.ts
 * @description Подпункты: один уровень вложенности, синхронизация отметок,
 *              порядок внутри родителя и переезд поддерева между списками.
 *
 * Здесь проверяются ровно те правила, которые ломаются тихо: глубина
 * вложенности, привязка подпункта к списку родителя и производная отметка
 * выполнения. Часть из них держит сама БД — составной внешний ключ
 * `(parentId, listId)` с каскадами; такие проверки идут прямыми запросами
 * Prisma, минуя Actions, потому что Action до них просто не доходит.
 */

import { describe, expect, it } from "vitest";

import { addItem, deleteItem, moveItem, moveItemToList, toggleItem } from "@/app/actions";
import { prisma, setSessionUser } from "./setup";
import { formData, makeItem, makeList, makeUser, shareList } from "./factories";

/** Названия подпунктов родителя в порядке отображения. */
async function subOrder(parentId: string): Promise<string[]> {
  const items = await prisma.item.findMany({
    where: { parentId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { name: true },
  });
  return items.map((i) => i.name);
}

/** Отметки выполнения: [родитель, ...подпункты в порядке создания]. */
async function completion(parentId: string): Promise<boolean[]> {
  const parent = await prisma.item.findUniqueOrThrow({
    where: { id: parentId },
    select: {
      isCompleted: true,
      children: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { isCompleted: true },
      },
    },
  });
  return [parent.isCompleted, ...parent.children.map((c) => c.isCompleted)];
}

/** Пользователь, список, пункт «Ужин» и два его подпункта. */
async function seed() {
  const user = await makeUser();
  const list = await makeList(user.id, user.defaultSpaceId);
  const parent = await makeItem(list.id, { name: "Ужин" });
  const first = await makeItem(list.id, { name: "Купить", parentId: parent.id });
  const second = await makeItem(list.id, { name: "Готовить", parentId: parent.id });
  setSessionUser(user.id);
  return { user, list, parent, first, second };
}

describe("addItem — создание подпункта", () => {
  it("привязывает подпункт к пункту и к его списку", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const parent = await makeItem(list.id, { name: "Ужин" });
    setSessionUser(user.id);

    await addItem(
      formData({
        itemName: "Купить",
        listId: list.id,
        parentItemId: parent.id,
        spaceId: user.defaultSpaceId,
      }),
    );

    const created = await prisma.item.findFirstOrThrow({ where: { name: "Купить" } });
    expect(created.parentId).toBe(parent.id);
    expect(created.listId).toBe(list.id);
  });

  it("считает позицию среди подпунктов родителя, а не среди пунктов списка", async () => {
    const { user, list, parent } = await seed();
    // В списке уже есть пункт с большой позицией: если бы максимум брался по
    // всему списку, новый подпункт уехал бы за него.
    await makeItem(list.id, { name: "Уборка", position: 1000 });

    await addItem(
      formData({
        itemName: "Убрать",
        listId: list.id,
        parentItemId: parent.id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(await subOrder(parent.id)).toEqual(["Купить", "Готовить", "Убрать"]);
    const created = await prisma.item.findFirstOrThrow({ where: { name: "Убрать" } });
    expect(created.position).toBeLessThan(1000);
  });

  it("отклоняет второй уровень вложенности", async () => {
    const { user, list, first } = await seed();

    const result = await addItem(
      formData({
        itemName: "Слишком глубоко",
        listId: list.id,
        parentItemId: first.id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(false);
    expect(await prisma.item.count({ where: { parentId: first.id } })).toBe(0);
  });

  it("отклоняет родителя из другого списка", async () => {
    const { user, parent } = await seed();
    const other = await makeList(user.id, user.defaultSpaceId, { title: "Другой" });

    const result = await addItem(
      formData({
        itemName: "Чужой",
        listId: other.id,
        parentItemId: parent.id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(false);
    expect(await prisma.item.count({ where: { listId: other.id } })).toBe(0);
  });

  it("отклоняет родителя в недоступном списке", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const parent = await makeItem(list.id, { name: "Ужин" });
    const stranger = await makeUser();
    setSessionUser(stranger.id);

    const result = await addItem(
      formData({
        itemName: "Подсмотренный",
        listId: list.id,
        parentItemId: parent.id,
        spaceId: stranger.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(false);
    expect(await prisma.item.count({ where: { parentId: parent.id } })).toBe(0);
  });

  it("редактор расшаренного списка может добавить подпункт", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const parent = await makeItem(list.id, { name: "Ужин" });
    const editor = await makeUser();
    await shareList(list.id, editor.id, editor.defaultSpaceId);
    setSessionUser(editor.id);

    const result = await addItem(
      formData({
        itemName: "Купить",
        listId: list.id,
        parentItemId: parent.id,
        spaceId: editor.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(true);
    expect(await subOrder(parent.id)).toEqual(["Купить"]);
  });

  it("новый подпункт снимает отметку с выполненного пункта", async () => {
    const { user, list, parent } = await seed();
    await toggleItem(
      formData({ itemId: parent.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );
    expect(await completion(parent.id)).toEqual([true, true, true]);

    await addItem(
      formData({
        itemName: "Ещё дело",
        listId: list.id,
        parentItemId: parent.id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(await completion(parent.id)).toEqual([false, true, true, false]);
  });
});

describe("toggleItem — синхронизация отметок", () => {
  it("отметка пункта отмечает все его подпункты", async () => {
    const { user, parent } = await seed();

    await toggleItem(
      formData({ itemId: parent.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );

    expect(await completion(parent.id)).toEqual([true, true, true]);
  });

  it("снятие отметки с пункта снимает её со всех подпунктов", async () => {
    const { user, parent } = await seed();
    await toggleItem(
      formData({ itemId: parent.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );

    await toggleItem(
      formData({ itemId: parent.id, isCompleted: "true", spaceId: user.defaultSpaceId }),
    );

    expect(await completion(parent.id)).toEqual([false, false, false]);
  });

  it("отметка последнего невыполненного подпункта отмечает пункт", async () => {
    const { user, parent, first, second } = await seed();

    await toggleItem(
      formData({ itemId: first.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );
    expect(await completion(parent.id)).toEqual([false, true, false]);

    await toggleItem(
      formData({ itemId: second.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );
    expect(await completion(parent.id)).toEqual([true, true, true]);
  });

  it("снятие отметки с подпункта снимает её с пункта", async () => {
    const { user, parent, first } = await seed();
    await toggleItem(
      formData({ itemId: parent.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );

    await toggleItem(
      formData({ itemId: first.id, isCompleted: "true", spaceId: user.defaultSpaceId }),
    );

    expect(await completion(parent.id)).toEqual([false, false, true]);
  });

  it("пункт без подпунктов меняет только себя", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const item = await makeItem(list.id, { name: "Одиночка" });
    setSessionUser(user.id);

    await toggleItem(
      formData({ itemId: item.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );

    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.isCompleted).toBe(true);
  });
});

describe("deleteItem — каскад и пересчёт", () => {
  it("удаление пункта уносит его подпункты", async () => {
    const { user, list, parent } = await seed();

    await deleteItem(
      formData({ itemId: parent.id, spaceId: user.defaultSpaceId }),
    );

    expect(await prisma.item.count({ where: { listId: list.id } })).toBe(0);
  });

  it("удаление последнего невыполненного подпункта отмечает пункт", async () => {
    const { user, parent, first, second } = await seed();
    await toggleItem(
      formData({ itemId: first.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );

    await deleteItem(formData({ itemId: second.id, spaceId: user.defaultSpaceId }));

    expect(await completion(parent.id)).toEqual([true, true]);
  });

  it("пункт, оставшийся без подпунктов, сохраняет свою отметку", async () => {
    const { user, parent, first, second } = await seed();
    await toggleItem(
      formData({ itemId: parent.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );

    for (const id of [first.id, second.id]) {
      await deleteItem(formData({ itemId: id, spaceId: user.defaultSpaceId }));
    }

    // Отметка снова собственная: пересчитывать её не по чему.
    expect(await completion(parent.id)).toEqual([true]);
  });
});

describe("moveItem — порядок внутри уровня", () => {
  /** Пункт «Ужин» с подпунктами A, B, C и соседний пункт «Уборка». */
  async function seedLevels() {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const parent = await makeItem(list.id, { name: "Ужин", position: 1 });
    const subIds: Record<string, string> = {};
    for (const [name, position] of [["A", 1], ["B", 2], ["C", 3]] as const) {
      subIds[name] = (await makeItem(list.id, { name, position, parentId: parent.id })).id;
    }
    const neighbour = await makeItem(list.id, { name: "Уборка", position: 2 });
    setSessionUser(user.id);
    return { user, list, parent, neighbour, subIds };
  }

  it("перемещает подпункт внутри родителя", async () => {
    const { user, parent, subIds } = await seedLevels();

    const result = await moveItem(
      formData({
        itemId: subIds.C,
        previousItemId: "",
        nextItemId: subIds.A,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(true);
    expect(await subOrder(parent.id)).toEqual(["C", "A", "B"]);
  });

  it("отклоняет соседа с другого уровня как устаревшего", async () => {
    const { user, parent, neighbour, subIds } = await seedLevels();

    const result = await moveItem(
      formData({
        itemId: subIds.A,
        previousItemId: neighbour.id,
        nextItemId: "",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "stale" });
    expect(await subOrder(parent.id)).toEqual(["A", "B", "C"]);
  });

  it("перемещение пункта не трогает позиции подпунктов", async () => {
    const { user, list, parent, neighbour } = await seedLevels();
    const before = await prisma.item.findMany({
      where: { parentId: parent.id },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });

    await moveItem(
      formData({
        itemId: parent.id,
        previousItemId: neighbour.id,
        nextItemId: "",
        spaceId: user.defaultSpaceId,
      }),
    );

    const topLevel = await prisma.item.findMany({
      where: { listId: list.id, parentId: null },
      orderBy: { position: "asc" },
      select: { name: true },
    });
    expect(topLevel.map((i) => i.name)).toEqual(["Уборка", "Ужин"]);
    const after = await prisma.item.findMany({
      where: { parentId: parent.id },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
    expect(after).toEqual(before);
  });

  it("перенумерация при исчерпании точности затрагивает только свой уровень", async () => {
    const { user, list, parent, subIds } = await seedLevels();
    // Равные позиции у соседей — середина между ними не ляжет строго между,
    // и Action уходит в ветку перенумерации уровня.
    await prisma.item.update({ where: { id: subIds.A }, data: { position: 5 } });
    await prisma.item.update({ where: { id: subIds.B }, data: { position: 5 } });
    const topLevelBefore = await prisma.item.findMany({
      where: { listId: list.id, parentId: null },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });

    const result = await moveItem(
      formData({
        itemId: subIds.C,
        previousItemId: subIds.A,
        nextItemId: subIds.B,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(true);
    expect(await subOrder(parent.id)).toEqual(["A", "C", "B"]);
    const topLevelAfter = await prisma.item.findMany({
      where: { listId: list.id, parentId: null },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
    expect(topLevelAfter).toEqual(topLevelBefore);
  });
});

describe("moveItemToList — поддерево", () => {
  it("перенос пункта уводит подпункты в тот же список", async () => {
    const { user, parent, first, second } = await seed();
    const target = await makeList(user.id, user.defaultSpaceId, { title: "Получатель" });

    const result = await moveItemToList(
      formData({
        itemId: parent.id,
        targetListId: target.id,
        mode: "move",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(true);
    // listId подпунктов переписывает сама БД: ON UPDATE CASCADE на составном
    // ключе (parentId, listId). Если каскад пропадёт, здесь останется старый
    // список — либо запрос упадёт нарушением ключа.
    const children = await prisma.item.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { listId: true, parentId: true },
    });
    expect(children).toEqual([
      { listId: target.id, parentId: parent.id },
      { listId: target.id, parentId: parent.id },
    ]);
  });

  it("копия получает свои подпункты, а оригинал остаётся на месте", async () => {
    const { user, list, parent } = await seed();
    const target = await makeList(user.id, user.defaultSpaceId, { title: "Получатель" });

    await moveItemToList(
      formData({
        itemId: parent.id,
        targetListId: target.id,
        mode: "copy",
        spaceId: user.defaultSpaceId,
      }),
    );

    const copy = await prisma.item.findFirstOrThrow({
      where: { listId: target.id, parentId: null },
      select: { id: true },
    });
    expect(copy.id).not.toBe(parent.id);
    expect(await subOrder(copy.id)).toEqual(["Купить", "Готовить"]);
    expect(await subOrder(parent.id)).toEqual(["Купить", "Готовить"]);
    expect(await prisma.item.count({ where: { listId: list.id } })).toBe(3);
  });

  it("копия сбрасывает отметки выполнения на обоих уровнях", async () => {
    const { user, parent } = await seed();
    await toggleItem(
      formData({ itemId: parent.id, isCompleted: "false", spaceId: user.defaultSpaceId }),
    );
    const target = await makeList(user.id, user.defaultSpaceId, { title: "Получатель" });

    await moveItemToList(
      formData({
        itemId: parent.id,
        targetListId: target.id,
        mode: "copy",
        spaceId: user.defaultSpaceId,
      }),
    );

    const copied = await prisma.item.findMany({
      where: { listId: target.id },
      select: { isCompleted: true },
    });
    expect(copied).toHaveLength(3);
    expect(copied.every((i) => !i.isCompleted)).toBe(true);
  });

  it("отдельный подпункт в другой список не переносится", async () => {
    const { user, list, first } = await seed();
    const target = await makeList(user.id, user.defaultSpaceId, { title: "Получатель" });

    const result = await moveItemToList(
      formData({
        itemId: first.id,
        targetListId: target.id,
        mode: "move",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "subItem" });
    const unchanged = await prisma.item.findUniqueOrThrow({ where: { id: first.id } });
    expect(unchanged.listId).toBe(list.id);
    expect(await prisma.item.count({ where: { listId: target.id } })).toBe(0);
  });
});

describe("целостность на уровне БД", () => {
  it("подпункт нельзя привязать к пункту из другого списка", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const other = await makeList(user.id, user.defaultSpaceId, { title: "Другой" });
    const parent = await makeItem(list.id, { name: "Ужин" });

    // Составной ключ (parentId, listId) не найдёт цели: у родителя другой
    // listId. Это защита от ошибки в коде, а не от пользователя.
    await expect(
      prisma.item.create({
        data: { listId: other.id, parentId: parent.id, name: "Чужой", position: 1 },
      }),
    ).rejects.toThrow();
  });

  it("удаление списка уносит и пункты, и подпункты", async () => {
    const { list } = await seed();

    await prisma.list.delete({ where: { id: list.id } });

    expect(await prisma.item.count()).toBe(0);
  });
});
