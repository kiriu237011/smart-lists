/**
 * @file list-lifecycle.int.test.ts
 * @description Scoped DB-границы lifecycle списка и post-commit эффекты.
 *
 * Проверяется не только результат CRUD: создание с личной группой должно быть
 * атомарным, подмена пространства — fail-closed, а S3/Pusher не должны
 * удерживать или повторно открывать tenant-транзакцию после мутации.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createList,
  deleteList,
  renameList,
  setListAiEnabled,
} from "@/app/actions";
import {
  adminPrisma,
  flushAfter,
  prisma,
  setSessionUser,
} from "./setup";
import {
  formData,
  makeList,
  makeSpace,
  makeUser,
  shareList,
} from "./factories";

describe("createList", () => {
  it("атомарно создаёт список в начале личной группы", async () => {
    const user = await makeUser();
    const existingList = await makeList(user.id, user.defaultSpaceId);
    const group = await prisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: user.defaultSpaceId,
        name: "Работа",
        position: 1,
      },
    });
    await prisma.listGroupMembership.create({
      data: { groupId: group.id, listId: existingList.id, position: 1 },
    });
    setSessionUser(user.id);
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");

    const result = await createList(
      formData({
        title: "Новый",
        groupId: group.id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(true);
    expect(result.list?.groups).toEqual([
      { id: group.id, name: "Работа", position: 0 },
    ]);
    const stored = await prisma.list.findUniqueOrThrow({
      where: { id: result.list!.id },
      include: { groupMemberships: true },
    });
    expect(stored).toMatchObject({
      ownerId: user.id,
      spaceId: user.defaultSpaceId,
    });
    expect(stored.groupMemberships).toEqual([
      { groupId: group.id, listId: stored.id, position: 0 },
    ]);

    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledWith([user.id], null);
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
  });
});

describe("изоляция lifecycle списка по пространству", () => {
  it("не создаёт и не меняет строки через группу или список другого space", async () => {
    const user = await makeUser();
    const otherSpace = await makeSpace(user.id, "Другое");
    const list = await makeList(user.id, user.defaultSpaceId, {
      title: "Исходный",
    });
    const group = await prisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: user.defaultSpaceId,
        name: "Default",
        position: 1,
      },
    });
    setSessionUser(user.id);
    const { deleteObjects } = await import("@/lib/s3");
    const { notifyUsers } = await import("@/lib/notify");

    const createResult = await createList(
      formData({
        title: "Не должен появиться",
        groupId: group.id,
        spaceId: otherSpace.id,
      }),
    );
    const renameResult = await renameList(
      formData({
        listId: list.id,
        title: "Подмена",
        spaceId: otherSpace.id,
      }),
    );
    const aiResult = await setListAiEnabled(
      formData({
        listId: list.id,
        aiEnabled: "false",
        spaceId: otherSpace.id,
      }),
    );
    const deleteResult = await deleteList(
      formData({ listId: list.id, spaceId: otherSpace.id }),
    );

    expect(createResult).toEqual({ success: false, error: "Группа не найдена" });
    expect(renameResult).toEqual({
      success: false,
      error: "Только владелец может переименовать список",
    });
    expect(aiResult).toEqual({ success: false, error: "Список не найден" });
    expect(deleteResult).toEqual({
      success: false,
      error: "Только владелец может удалить список",
    });
    expect(
      await prisma.list.count({
        where: { ownerId: user.id, spaceId: otherSpace.id },
      }),
    ).toBe(0);
    expect(
      await prisma.list.findUnique({
        where: { id: list.id },
        select: { title: true, aiEnabled: true },
      }),
    ).toEqual({ title: "Исходный", aiEnabled: true });
    await flushAfter();
    expect(vi.mocked(deleteObjects)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
  });
});

describe("realtime lifecycle списка", () => {
  it("переименование уведомляет заранее вычисленных участников", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    setSessionUser(owner.id);
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");

    const result = await renameList(
      formData({
        listId: list.id,
        title: "Новое",
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledWith(
      [owner.id, editor.id],
      null,
    );
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
  });

  it("редактор меняет AI-флаг и уведомляет всех участников", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    setSessionUser(editor.id);
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");

    const result = await setListAiEnabled(
      formData({
        listId: list.id,
        aiEnabled: "false",
        spaceId: editor.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    expect(
      await prisma.list.findUnique({
        where: { id: list.id },
        select: { aiEnabled: true },
      }),
    ).toEqual({ aiEnabled: false });
    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledWith(
      [owner.id, editor.id],
      null,
    );
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
  });
});

describe("deleteList", () => {
  it("коммитит каскад до S3 и уведомляет сохранённых участников", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    const attachment = await prisma.attachment.create({
      data: {
        key: `lists/${list.id}/file.png`,
        name: "file.png",
        type: "IMAGE",
        contentType: "image/png",
        size: 100,
        status: "UPLOADED",
        listId: list.id,
        uploadedById: owner.id,
      },
    });
    setSessionUser(owner.id);
    const { deleteObjects } = await import("@/lib/s3");
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");
    vi.mocked(deleteObjects).mockImplementationOnce(async () => {
      expect(
        await adminPrisma.list.findUnique({ where: { id: list.id } }),
      ).toBeNull();
      expect(
        await adminPrisma.attachment.findUnique({
          where: { id: attachment.id },
        }),
      ).toBeNull();
    });

    const result = await deleteList(
      formData({ listId: list.id, spaceId: owner.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(vi.mocked(deleteObjects)).toHaveBeenCalledWith([attachment.key]);
    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledWith(
      [owner.id, editor.id],
      null,
    );
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
  });
});
