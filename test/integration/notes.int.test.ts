/**
 * @file notes.int.test.ts
 * @description Заметки списков и записей с optimistic concurrency по noteVersion.
 *
 * Заметка — единственное место с версионной защитой от потери совместных
 * правок: два редактора, сохраняющие поверх одной версии, не должны затирать
 * друг друга молча. Проверяется весь контракт — рост версии, отказ по
 * устаревшей версии с возвратом актуального значения, идемпотентность
 * повторного сохранения того же текста и доступ редактора.
 */

import { describe, expect, it, vi } from "vitest";

import { updateItemNote, updateListNote } from "@/app/actions";
import { flushAfter, prisma, setSessionUser } from "./setup";
import {
  formData,
  makeItem,
  makeList,
  makeSpace,
  makeUser,
  shareList,
} from "./factories";

describe("updateItemNote", () => {
  async function seed() {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const item = await makeItem(list.id, { name: "Молоко", position: 1 });
    setSessionUser(user.id);
    return { user, list, item };
  }

  it("сохраняет заметку и поднимает версию с 0 до 1", async () => {
    const { user, item } = await seed();

    const result = await updateItemNote(
      formData({
        itemId: item.id,
        note: "2 литра",
        expectedVersion: "0",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toMatchObject({ success: true, note: "2 литра", noteVersion: 1 });
    const saved = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(saved.note).toBe("2 литра");
    expect(saved.noteVersion).toBe(1);
    expect(saved.noteUpdatedAt).not.toBeNull();
  });

  it("отклоняет сохранение поверх устаревшей версии и возвращает актуальное", async () => {
    const { user, item } = await seed();
    // Первый редактор сохранил — версия стала 1.
    await updateItemNote(
      formData({
        itemId: item.id,
        note: "первая",
        expectedVersion: "0",
        spaceId: user.defaultSpaceId,
      }),
    );

    // Второй редактор всё ещё думает, что версия 0.
    const result = await updateItemNote(
      formData({
        itemId: item.id,
        note: "вторая",
        expectedVersion: "0",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toMatchObject({
      success: false,
      error: "noteConflict",
      currentNote: "первая",
      currentVersion: 1,
    });
    // Текст первого редактора не затёрт.
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).note,
    ).toBe("первая");
  });

  it("при параллельном сохранении одной версии принимает ровно одну правку", async () => {
    const { user, item } = await seed();

    const results = await Promise.all([
      updateItemNote(
        formData({
          itemId: item.id,
          note: "первая",
          expectedVersion: "0",
          spaceId: user.defaultSpaceId,
        }),
      ),
      updateItemNote(
        formData({
          itemId: item.id,
          note: "вторая",
          expectedVersion: "0",
          spaceId: user.defaultSpaceId,
        }),
      ),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    const conflict = results.find((result) => !result.success);
    expect(conflict).toMatchObject({
      success: false,
      error: "noteConflict",
      currentVersion: 1,
    });

    const saved = await prisma.item.findUniqueOrThrow({
      where: { id: item.id },
      select: { note: true, noteVersion: true },
    });
    expect(saved.noteVersion).toBe(1);
    expect(["первая", "вторая"]).toContain(saved.note);
    expect(conflict).toMatchObject({ currentNote: saved.note });
  });

  it("повторное сохранение того же текста не поднимает версию", async () => {
    const { user, item } = await seed();
    await updateItemNote(
      formData({
        itemId: item.id,
        note: "текст",
        expectedVersion: "0",
        spaceId: user.defaultSpaceId,
      }),
    );

    const result = await updateItemNote(
      formData({
        itemId: item.id,
        note: "текст",
        expectedVersion: "1",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toMatchObject({ success: true, noteVersion: 1 });
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).noteVersion,
    ).toBe(1);
  });

  it("пустая заметка сохраняется как null и очищает текст", async () => {
    const { user, item } = await seed();
    await updateItemNote(
      formData({
        itemId: item.id,
        note: "было",
        expectedVersion: "0",
        spaceId: user.defaultSpaceId,
      }),
    );

    const result = await updateItemNote(
      formData({
        itemId: item.id,
        note: "   ",
        expectedVersion: "1",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toMatchObject({ success: true, note: null, noteVersion: 2 });
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).note,
    ).toBeNull();
  });

  it("нормализует переносы строк перед сохранением", async () => {
    const { user, item } = await seed();

    await updateItemNote(
      formData({
        itemId: item.id,
        note: "  первая\r\nвторая  ",
        expectedVersion: "0",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).note,
    ).toBe("первая\nвторая");
  });

  it("редактор может редактировать заметку записи", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    const item = await makeItem(list.id, { name: "Молоко", position: 1 });
    setSessionUser(editor.id);
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");

    const result = await updateItemNote(
      formData({
        itemId: item.id,
        note: "от редактора",
        expectedVersion: "0",
        spaceId: editor.defaultSpaceId,
        socketId: "123.456",
      }),
    );

    expect(result).toMatchObject({ success: true, noteVersion: 1 });
    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledWith(
      [owner.id, editor.id],
      "123.456",
    );
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
  });

  it("посторонний не может редактировать заметку", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const item = await makeItem(list.id, { name: "Молоко", position: 1 });
    setSessionUser(stranger.id);

    const result = await updateItemNote(
      formData({
        itemId: item.id,
        note: "взлом",
        expectedVersion: "0",
        spaceId: stranger.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "Запись не найдена" });
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).note,
    ).toBeNull();
  });

  it("не редактирует запись через другое пространство владельца", async () => {
    const { user, item } = await seed();
    const otherSpace = await makeSpace(user.id, "Другое");

    const result = await updateItemNote(
      formData({
        itemId: item.id,
        note: "не в том пространстве",
        expectedVersion: "0",
        spaceId: otherSpace.id,
      }),
    );

    expect(result).toEqual({ success: false, error: "Запись не найдена" });
    expect(
      await prisma.item.findUniqueOrThrow({
        where: { id: item.id },
        select: { note: true, noteVersion: true },
      }),
    ).toMatchObject({ note: null, noteVersion: 0 });
  });
});

describe("updateListNote", () => {
  async function seed() {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);
    return { user, list };
  }

  it("сохраняет общую заметку списка и поднимает версию", async () => {
    const { user, list } = await seed();

    const result = await updateListNote(
      formData({
        listId: list.id,
        note: "общая заметка",
        expectedVersion: "0",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toMatchObject({ success: true, note: "общая заметка", noteVersion: 1 });
    const saved = await prisma.list.findUniqueOrThrow({ where: { id: list.id } });
    expect(saved.note).toBe("общая заметка");
    expect(saved.noteVersion).toBe(1);
  });

  it("отклоняет устаревшую версию и возвращает актуальную заметку", async () => {
    const { user, list } = await seed();
    await updateListNote(
      formData({
        listId: list.id,
        note: "первая",
        expectedVersion: "0",
        spaceId: user.defaultSpaceId,
      }),
    );

    const result = await updateListNote(
      formData({
        listId: list.id,
        note: "вторая",
        expectedVersion: "0",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toMatchObject({
      success: false,
      error: "noteConflict",
      currentNote: "первая",
      currentVersion: 1,
    });
  });

  it("редактор может редактировать общую заметку списка", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    setSessionUser(editor.id);
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");

    const result = await updateListNote(
      formData({
        listId: list.id,
        note: "правка редактора",
        expectedVersion: "0",
        spaceId: editor.defaultSpaceId,
        socketId: "789.012",
      }),
    );

    expect(result).toMatchObject({ success: true, noteVersion: 1 });
    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledWith(
      [owner.id, editor.id],
      "789.012",
    );
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
  });

  it("не редактирует заметку списка через другое пространство владельца", async () => {
    const { user, list } = await seed();
    const otherSpace = await makeSpace(user.id, "Архив");

    const result = await updateListNote(
      formData({
        listId: list.id,
        note: "не в том пространстве",
        expectedVersion: "0",
        spaceId: otherSpace.id,
      }),
    );

    expect(result).toEqual({ success: false, error: "Список не найден" });
    expect(
      await prisma.list.findUniqueOrThrow({
        where: { id: list.id },
        select: { note: true, noteVersion: true },
      }),
    ).toMatchObject({ note: null, noteVersion: 0 });
  });
});
