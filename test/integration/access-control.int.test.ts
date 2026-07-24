/**
 * @file access-control.int.test.ts
 * @description Права доступа к спискам и изоляция по пространству.
 *
 * Это самое тихое место в приложении: ошибка не роняет сборку, а просто даёт
 * доступ к чужим данным. Поэтому проверяется не только код возврата Action, но
 * и фактическое состояние БД — что запись действительно не создана и список
 * действительно не изменён при отказе.
 *
 * Разделение владельца и редактора: содержимое (записи, их названия, статус)
 * доступно участнику по `ListShare`; владение (переименование и удаление
 * самого списка) остаётся за владельцем.
 */

import { describe, expect, it } from "vitest";

import {
  addItem,
  deleteList,
  renameItem,
  renameList,
  toggleItem,
} from "@/app/actions";
import { clearSession, prisma, setSessionUser } from "./setup";
import { formData, makeItem, makeList, makeUser, shareList } from "./factories";

describe("авторизация и пространство", () => {
  it("без сессии addItem не пишет в БД", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    clearSession();

    const result = await addItem(
      formData({ itemName: "Молоко", listId: list.id, spaceId: owner.defaultSpaceId }),
    );

    expect(result).toEqual({ success: false, error: "Необходима авторизация" });
    expect(await prisma.item.count()).toBe(0);
  });

  it("чужой spaceId отклоняется до всякой работы со списком", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    // spaceId принадлежит другому пользователю — resolveActionSpace вернёт null.
    const result = await addItem(
      formData({
        itemName: "Молоко",
        listId: list.id,
        spaceId: stranger.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "Пространство не найдено" });
    expect(await prisma.item.count()).toBe(0);
  });
});

describe("владелец", () => {
  it("добавляет запись в свой список", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    const result = await addItem(
      formData({ itemName: "Молоко", listId: list.id, spaceId: owner.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    const items = await prisma.item.findMany({ where: { listId: list.id } });
    expect(items).toHaveLength(1);
    expect(items[0].addedById).toBe(owner.id);
  });
});

describe("редактор (список расшарен)", () => {
  /** Владелец, редактор с доступом к списку в его default-пространстве. */
  async function seedShared() {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId, { title: "Общий" });
    await shareList(list.id, editor.id); // в default-пространстве редактора
    return { owner, editor, list };
  }

  it("добавляет запись в расшаренный список из своего пространства", async () => {
    const { editor, list } = await seedShared();
    setSessionUser(editor.id);

    const result = await addItem(
      formData({ itemName: "Хлеб", listId: list.id, spaceId: editor.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    const items = await prisma.item.findMany({ where: { listId: list.id } });
    expect(items).toHaveLength(1);
    // Автором записи становится редактор, а не владелец списка.
    expect(items[0].addedById).toBe(editor.id);
  });

  it("переименовывает запись в расшаренном списке", async () => {
    const { editor, list } = await seedShared();
    const item = await makeItem(list.id, { name: "старое" });
    setSessionUser(editor.id);

    const result = await renameItem(
      formData({ itemId: item.id, itemName: "новое", spaceId: editor.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.name).toBe("новое");
  });

  it("переключает статус записи в расшаренном списке", async () => {
    const { editor, list } = await seedShared();
    const item = await makeItem(list.id, { isCompleted: false });
    setSessionUser(editor.id);

    await toggleItem(
      formData({
        itemId: item.id,
        isCompleted: "false",
        spaceId: editor.defaultSpaceId,
      }),
    );

    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.isCompleted).toBe(true);
  });

  it("НЕ может переименовать сам список: это право владельца", async () => {
    const { editor, list } = await seedShared();
    setSessionUser(editor.id);

    const result = await renameList(
      formData({ listId: list.id, title: "Взломано", spaceId: editor.defaultSpaceId }),
    );

    expect(result).toEqual({
      success: false,
      error: "Только владелец может переименовать список",
    });
    const unchanged = await prisma.list.findUniqueOrThrow({ where: { id: list.id } });
    expect(unchanged.title).toBe("Общий");
  });

  it("НЕ может удалить сам список: это право владельца", async () => {
    const { editor, list } = await seedShared();
    setSessionUser(editor.id);

    const result = await deleteList(
      formData({ listId: list.id, spaceId: editor.defaultSpaceId }),
    );

    expect(result).toEqual({
      success: false,
      error: "Только владелец может удалить список",
    });
    expect(await prisma.list.findUnique({ where: { id: list.id } })).not.toBeNull();
  });
});

describe("посторонний (нет ни владения, ни share)", () => {
  it("не видит чужой список даже из собственного пространства", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(stranger.id);

    const result = await addItem(
      formData({
        itemName: "Молоко",
        listId: list.id,
        spaceId: stranger.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "Список не найден" });
    expect(await prisma.item.count()).toBe(0);
  });

  it("не может переименовать запись в чужом списке", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const item = await makeItem(list.id, { name: "оригинал" });
    setSessionUser(stranger.id);

    const result = await renameItem(
      formData({
        itemId: item.id,
        itemName: "взломано",
        spaceId: stranger.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "Запись не найдена" });
    const unchanged = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(unchanged.name).toBe("оригинал");
  });
});

describe("изоляция по пространству", () => {
  it("список не виден владельцу из другого его пространства", async () => {
    const owner = await makeUser();
    const otherSpace = await prisma.space.create({
      data: { userId: owner.id, name: "Работа", normalizedName: "работа" },
    });
    // Список лежит в default-пространстве.
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    // Тот же владелец, но действие адресовано другому пространству.
    const result = await addItem(
      formData({ itemName: "Молоко", listId: list.id, spaceId: otherSpace.id }),
    );

    expect(result).toEqual({ success: false, error: "Список не найден" });
    expect(await prisma.item.count()).toBe(0);
  });

  it("тот же список доступен из правильного пространства", async () => {
    const owner = await makeUser();
    await prisma.space.create({
      data: { userId: owner.id, name: "Работа", normalizedName: "работа" },
    });
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    const result = await addItem(
      formData({ itemName: "Молоко", listId: list.id, spaceId: owner.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
  });
});
