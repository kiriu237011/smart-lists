/**
 * @file items.int.test.ts
 * @description Записи: добавление, порядок, перемещение и перенос между списками.
 *
 * Порядок задаётся дробным `Item.position`, и его арифметика — самая тонкая
 * часть приложения. Проверяется не значение позиции (оно произвольно), а
 * наблюдаемый порядок выборки: тот же контракт, что видит UI. Отдельно
 * покрыта вырожденная ветка перенумерации, которую в проде почти не встретить,
 * — здесь она вызывается детерминированно равными позициями соседей.
 */

import { describe, expect, it, vi } from "vitest";

import {
  addItem,
  deleteItem,
  moveItem,
  moveItemToList,
  renameItem,
  toggleItem,
} from "@/app/actions";
import { flushAfter, prisma, setSessionUser } from "./setup";
import {
  formData,
  makeItem,
  makeList,
  makeSpace,
  makeUser,
  shareList,
} from "./factories";

/** Названия записей списка в порядке отображения (position, затем createdAt, id). */
async function order(listId: string): Promise<string[]> {
  const items = await prisma.item.findMany({
    where: { listId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { name: true },
  });
  return items.map((i) => i.name);
}

describe("addItem — позиция", () => {
  it("первая запись получает положительную позицию", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    await addItem(formData({ itemName: "A", listId: list.id, spaceId: user.defaultSpaceId }));

    const item = await prisma.item.findFirstOrThrow({ where: { listId: list.id } });
    expect(item.position).toBeGreaterThan(0);
  });

  it("новая запись встаёт в конец (позиция строго больше предыдущей)", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    await addItem(formData({ itemName: "A", listId: list.id, spaceId: user.defaultSpaceId }));
    await addItem(formData({ itemName: "B", listId: list.id, spaceId: user.defaultSpaceId }));

    expect(await order(list.id)).toEqual(["A", "B"]);
    const items = await prisma.item.findMany({
      where: { listId: list.id },
      orderBy: { position: "asc" },
    });
    expect(items[1].position).toBeGreaterThan(items[0].position);
  });
});

describe("item lifecycle — scoped DB и realtime", () => {
  it("add/rename/toggle/delete уведомляют owner и editor без tenant-read в after", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    setSessionUser(editor.id);
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");

    async function expectRefresh(action: () => Promise<unknown>) {
      vi.mocked(notifyUsers).mockClear();
      vi.mocked(notifyListMembers).mockClear();

      await action();

      expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
      await flushAfter();
      expect(vi.mocked(notifyUsers)).toHaveBeenCalledOnce();
      expect(vi.mocked(notifyUsers)).toHaveBeenCalledWith(
        [owner.id, editor.id],
        "123.456",
      );
      expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
    }

    await expectRefresh(() =>
      addItem(
        formData({
          itemName: "Молоко",
          listId: list.id,
          spaceId: editor.defaultSpaceId,
          socketId: "123.456",
        }),
      ),
    );
    const item = await prisma.item.findFirstOrThrow({
      where: { listId: list.id, name: "Молоко" },
    });

    await expectRefresh(() =>
      renameItem(
        formData({
          itemId: item.id,
          itemName: "Молоко 2л",
          spaceId: editor.defaultSpaceId,
          socketId: "123.456",
        }),
      ),
    );
    await expectRefresh(() =>
      toggleItem(
        formData({
          itemId: item.id,
          isCompleted: "false",
          spaceId: editor.defaultSpaceId,
          socketId: "123.456",
        }),
      ),
    );
    await expectRefresh(() =>
      deleteItem(
        formData({
          itemId: item.id,
          spaceId: editor.defaultSpaceId,
          socketId: "123.456",
        }),
      ),
    );

    expect(await prisma.item.findUnique({ where: { id: item.id } })).toBeNull();
  });

  it("add/rename/toggle/delete fail-closed через другое пространство владельца", async () => {
    const owner = await makeUser();
    const otherSpace = await makeSpace(owner.id, "Другое");
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const item = await makeItem(list.id, {
      name: "Исходное",
      isCompleted: false,
    });
    setSessionUser(owner.id);

    const addResult = await addItem(
      formData({
        itemName: "Лишнее",
        listId: list.id,
        spaceId: otherSpace.id,
      }),
    );
    const renameResult = await renameItem(
      formData({
        itemId: item.id,
        itemName: "Подмена",
        spaceId: otherSpace.id,
      }),
    );
    await toggleItem(
      formData({
        itemId: item.id,
        isCompleted: "false",
        spaceId: otherSpace.id,
      }),
    );
    await deleteItem(formData({ itemId: item.id, spaceId: otherSpace.id }));

    expect(addResult).toEqual({ success: false, error: "Список не найден" });
    expect(renameResult).toEqual({
      success: false,
      error: "Запись не найдена",
    });
    expect(await prisma.item.findMany({ where: { listId: list.id } })).toEqual([
      expect.objectContaining({
        id: item.id,
        name: "Исходное",
        isCompleted: false,
      }),
    ]);
  });
});

describe("moveItem — обычный путь (одна запись в БД)", () => {
  /** Список A(1) B(2) C(3) D(4); возвращает id по имени. */
  async function seed() {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const ids: Record<string, string> = {};
    for (const [name, position] of [["A", 1], ["B", 2], ["C", 3], ["D", 4]] as const) {
      ids[name] = (await makeItem(list.id, { name, position })).id;
    }
    setSessionUser(user.id);
    return { user, list, ids };
  }

  it("перемещает запись между соседями", async () => {
    const { user, list, ids } = await seed();

    await moveItem(
      formData({
        itemId: ids.D,
        previousItemId: ids.A,
        nextItemId: ids.B,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(await order(list.id)).toEqual(["A", "D", "B", "C"]);
  });

  it("перемещает запись в начало списка", async () => {
    const { user, list, ids } = await seed();

    await moveItem(
      formData({
        itemId: ids.C,
        previousItemId: "",
        nextItemId: ids.A,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(await order(list.id)).toEqual(["C", "A", "B", "D"]);
  });

  it("перемещает запись в конец списка", async () => {
    const { user, list, ids } = await seed();

    await moveItem(
      formData({
        itemId: ids.B,
        previousItemId: ids.D,
        nextItemId: "",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(await order(list.id)).toEqual(["A", "C", "D", "B"]);
  });

  it("пишет ровно одну строку: соседи сохраняют свои позиции", async () => {
    const { user, list, ids } = await seed();
    const before = await prisma.item.findMany({
      where: { listId: list.id, id: { in: [ids.A, ids.B] } },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });

    await moveItem(
      formData({
        itemId: ids.D,
        previousItemId: ids.A,
        nextItemId: ids.B,
        spaceId: user.defaultSpaceId,
      }),
    );

    const after = await prisma.item.findMany({
      where: { listId: list.id, id: { in: [ids.A, ids.B] } },
      orderBy: { position: "asc" },
      select: { id: true, position: true },
    });
    // Обычный путь не трогает соседей — перенумерации не было.
    expect(after).toEqual(before);
  });
});

describe("moveItem — устойчивость", () => {
  it("возвращает stale, когда сосед исчез, и не меняет порядок", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const a = await makeItem(list.id, { name: "A", position: 1 });
    const b = await makeItem(list.id, { name: "B", position: 2 });
    setSessionUser(user.id);

    const result = await moveItem(
      formData({
        itemId: b.id,
        previousItemId: "нет-такого-соседа",
        nextItemId: "",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "stale" });
    const unchanged = await prisma.item.findUniqueOrThrow({ where: { id: a.id } });
    expect(unchanged.position).toBe(1);
    expect(await order(list.id)).toEqual(["A", "B"]);
  });

  it("единственную запись двигать некуда — успех без изменений", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const only = await makeItem(list.id, { name: "A", position: 1 });
    setSessionUser(user.id);

    const result = await moveItem(
      formData({
        itemId: only.id,
        previousItemId: "",
        nextItemId: "",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    expect((await prisma.item.findUniqueOrThrow({ where: { id: only.id } })).position).toBe(1);
  });

  it("не двигает запись в чужом списке", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const a = await makeItem(list.id, { name: "A", position: 1 });
    const b = await makeItem(list.id, { name: "B", position: 2 });
    setSessionUser(stranger.id);

    const result = await moveItem(
      formData({
        itemId: b.id,
        previousItemId: "",
        nextItemId: a.id,
        spaceId: stranger.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(false);
    expect(await order(list.id)).toEqual(["A", "B"]);
  });
});

describe("moveItem — ветка перенумерации", () => {
  it("перенумеровывает список, когда середина не ложится между равными соседями", async () => {
    // Соседи с РАВНЫМИ позициями: их середина совпадает с позицией соседа,
    // строго между ними не встать — Action вынужден перенумеровать весь список.
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const a = await makeItem(list.id, { name: "A", position: 1 });
    const b = await makeItem(list.id, { name: "B", position: 1 });
    const x = await makeItem(list.id, { name: "X", position: 5 });
    setSessionUser(user.id);

    const result = await moveItem(
      formData({
        itemId: x.id,
        previousItemId: a.id,
        nextItemId: b.id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    // X встал строго между A и B.
    expect(await order(list.id)).toEqual(["A", "X", "B"]);

    // После перенумерации все позиции различны — вырожденное состояние ушло.
    const positions = (
      await prisma.item.findMany({ where: { listId: list.id }, select: { position: true } })
    ).map((i) => i.position);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe("deleteItem", () => {
  it("удаляет запись, не трогая соседей и их порядок", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    await makeItem(list.id, { name: "A", position: 1 });
    const b = await makeItem(list.id, { name: "B", position: 2 });
    await makeItem(list.id, { name: "C", position: 3 });
    setSessionUser(user.id);

    await deleteItem(formData({ itemId: b.id, spaceId: user.defaultSpaceId }));

    expect(await order(list.id)).toEqual(["A", "C"]);
  });

  it("не удаляет запись из чужого списка", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const item = await makeItem(list.id, { name: "A", position: 1 });
    setSessionUser(stranger.id);

    await deleteItem(formData({ itemId: item.id, spaceId: stranger.defaultSpaceId }));

    expect(await prisma.item.findUnique({ where: { id: item.id } })).not.toBeNull();
  });
});

describe("moveItemToList — перенос (move)", () => {
  /** Два списка одного пользователя; запись «Молоко» в исходном. */
  async function seedTwoLists() {
    const user = await makeUser();
    const source = await makeList(user.id, user.defaultSpaceId, { title: "Источник" });
    const target = await makeList(user.id, user.defaultSpaceId, { title: "Получатель" });
    const item = await makeItem(source.id, { name: "Молоко", position: 1 });
    setSessionUser(user.id);
    return { user, source, target, item };
  }

  it("меняет список у той же строки, сохраняя её ID", async () => {
    const { user, source, target, item } = await seedTwoLists();

    const result = await moveItemToList(
      formData({
        itemId: item.id,
        targetListId: target.id,
        mode: "move",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    const moved = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(moved.listId).toBe(target.id);
    expect(await prisma.item.count({ where: { listId: source.id } })).toBe(0);
  });

  it("встаёт в конец списка-получателя", async () => {
    const { user, target, item } = await seedTwoLists();
    await makeItem(target.id, { name: "Хлеб", position: 1 });

    await moveItemToList(
      formData({
        itemId: item.id,
        targetListId: target.id,
        mode: "move",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(await order(target.id)).toEqual(["Хлеб", "Молоко"]);
  });

  it("отклоняет перенос в тот же список", async () => {
    const { user, source, item } = await seedTwoLists();

    const result = await moveItemToList(
      formData({
        itemId: item.id,
        targetListId: source.id,
        mode: "move",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "sameList" });
  });

  it("не находит список-получатель из другого пространства", async () => {
    const user = await makeUser();
    const otherSpace = await prisma.space.create({
      data: { userId: user.id, name: "Другое", normalizedName: "другое" },
    });
    const source = await makeList(user.id, user.defaultSpaceId);
    const target = await makeList(user.id, otherSpace.id);
    const item = await makeItem(source.id, { name: "Молоко", position: 1 });
    setSessionUser(user.id);

    const result = await moveItemToList(
      formData({
        itemId: item.id,
        targetListId: target.id,
        mode: "move",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "Список не найден" });
    // Запись осталась в исходном списке.
    expect(await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      listId: source.id,
    });
  });

  it("редактор переносит запись между расшаренными списками", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const source = await makeList(owner.id, owner.defaultSpaceId, { title: "И" });
    const target = await makeList(owner.id, owner.defaultSpaceId, { title: "П" });
    await shareList(source.id, editor.id);
    await shareList(target.id, editor.id);
    const item = await makeItem(source.id, { name: "Молоко", position: 1 });
    setSessionUser(editor.id);

    const result = await moveItemToList(
      formData({
        itemId: item.id,
        targetListId: target.id,
        mode: "move",
        spaceId: editor.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    expect(await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      listId: target.id,
    });
  });
});

describe("moveItemToList — копирование (copy)", () => {
  async function seedForCopy() {
    const user = await makeUser();
    const source = await makeList(user.id, user.defaultSpaceId, { title: "Источник" });
    const target = await makeList(user.id, user.defaultSpaceId, { title: "Получатель" });
    setSessionUser(user.id);
    return { user, source, target };
  }

  it("оставляет оригинал и создаёт новую строку в получателе", async () => {
    const { user, source, target } = await seedForCopy();
    const original = await makeItem(source.id, { name: "Молоко", position: 1 });

    await moveItemToList(
      formData({
        itemId: original.id,
        targetListId: target.id,
        mode: "copy",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(await prisma.item.count({ where: { listId: source.id } })).toBe(1);
    const copies = await prisma.item.findMany({ where: { listId: target.id } });
    expect(copies).toHaveLength(1);
    expect(copies[0].id).not.toBe(original.id);
    expect(copies[0].name).toBe("Молоко");
  });

  it("сбрасывает у копии статус выполнения, версию заметки и автора", async () => {
    const { user, source, target } = await seedForCopy();
    // Оригинал: выполнен, с заметкой версии 3, добавлен другим пользователем.
    const other = await makeUser();
    const original = await prisma.item.create({
      data: {
        listId: source.id,
        name: "Молоко",
        position: 1,
        isCompleted: true,
        note: "2 литра",
        noteVersion: 3,
        addedById: other.id,
      },
    });

    await moveItemToList(
      formData({
        itemId: original.id,
        targetListId: target.id,
        mode: "copy",
        spaceId: user.defaultSpaceId,
      }),
    );

    const copy = await prisma.item.findFirstOrThrow({ where: { listId: target.id } });
    expect(copy.isCompleted).toBe(false);
    expect(copy.noteVersion).toBe(0);
    expect(copy.note).toBe("2 литра");
    // Автором копии становится копирующий, а не автор оригинала.
    expect(copy.addedById).toBe(user.id);
    expect(copy.noteUpdatedAt).not.toBeNull();
  });
});
