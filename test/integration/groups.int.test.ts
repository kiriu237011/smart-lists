/**
 * @file groups.int.test.ts
 * @description Группы списков: персональная организация внутри пространства.
 *
 * Группы приватны для пользователя, а один список может лежать в разных
 * группах у разных участников. Проверяется, что владение группой строго
 * персонально (чужую не тронуть), что членство списка требует доступа к списку
 * и что удаление группы разрывает связь, но не трогает сами списки.
 */

import { describe, expect, it } from "vitest";

import {
  addListToGroup,
  createGroup,
  deleteGroup,
  removeListFromGroup,
  renameGroup,
} from "@/app/actions";
import { prisma, setSessionUser } from "./setup";
import { formData, makeList, makeSpace, makeUser, shareList } from "./factories";

/** ID списков, входящих в группу. */
async function listsInGroup(groupId: string): Promise<string[]> {
  const group = await prisma.listGroup.findUniqueOrThrow({
    where: { id: groupId },
    select: { lists: { select: { id: true } } },
  });
  return group.lists.map((l) => l.id).sort();
}

describe("createGroup", () => {
  it("создаёт группу в пространстве пользователя", async () => {
    const user = await makeUser();
    setSessionUser(user.id);

    const result = await createGroup(
      formData({ name: "Работа", spaceId: user.defaultSpaceId }),
    );

    expect(result).toMatchObject({ success: true, group: { name: "Работа" } });
    const groups = await prisma.listGroup.findMany({ where: { userId: user.id } });
    expect(groups).toHaveLength(1);
    expect(groups[0].spaceId).toBe(user.defaultSpaceId);
  });

  it("отклоняет слишком длинное имя", async () => {
    const user = await makeUser();
    setSessionUser(user.id);

    const result = await createGroup(
      formData({ name: "я".repeat(51), spaceId: user.defaultSpaceId }),
    );

    expect(result.success).toBe(false);
    expect(await prisma.listGroup.count()).toBe(0);
  });
});

describe("deleteGroup", () => {
  it("удаляет свою группу", async () => {
    const user = await makeUser();
    const group = await prisma.listGroup.create({
      data: { userId: user.id, spaceId: user.defaultSpaceId, name: "Дом" },
    });
    setSessionUser(user.id);

    const result = await deleteGroup(
      formData({ groupId: group.id, spaceId: user.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(await prisma.listGroup.findUnique({ where: { id: group.id } })).toBeNull();
  });

  it("не удаляет чужую группу", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const group = await prisma.listGroup.create({
      data: { userId: owner.id, spaceId: owner.defaultSpaceId, name: "Дом" },
    });
    setSessionUser(other.id);

    const result = await deleteGroup(
      formData({ groupId: group.id, spaceId: other.defaultSpaceId }),
    );

    expect(result).toEqual({
      success: false,
      error: "Только владелец может удалить группу",
    });
    expect(await prisma.listGroup.findUnique({ where: { id: group.id } })).not.toBeNull();
  });

  it("удаление группы разрывает связь, но не удаляет списки", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const group = await prisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: user.defaultSpaceId,
        name: "Дом",
        lists: { connect: { id: list.id } },
      },
    });
    setSessionUser(user.id);

    await deleteGroup(formData({ groupId: group.id, spaceId: user.defaultSpaceId }));

    // Список пережил удаление группы.
    expect(await prisma.list.findUnique({ where: { id: list.id } })).not.toBeNull();
  });
});

describe("renameGroup", () => {
  it("переименовывает свою группу", async () => {
    const user = await makeUser();
    const group = await prisma.listGroup.create({
      data: { userId: user.id, spaceId: user.defaultSpaceId, name: "Старое" },
    });
    setSessionUser(user.id);

    const result = await renameGroup(
      formData({ groupId: group.id, name: "Новое", spaceId: user.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(
      (await prisma.listGroup.findUniqueOrThrow({ where: { id: group.id } })).name,
    ).toBe("Новое");
  });

  it("не переименовывает чужую группу", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const group = await prisma.listGroup.create({
      data: { userId: owner.id, spaceId: owner.defaultSpaceId, name: "Owner" },
    });
    setSessionUser(other.id);

    const result = await renameGroup(
      formData({ groupId: group.id, name: "Взлом", spaceId: other.defaultSpaceId }),
    );

    expect(result.success).toBe(false);
    expect(
      (await prisma.listGroup.findUniqueOrThrow({ where: { id: group.id } })).name,
    ).toBe("Owner");
  });
});

describe("addListToGroup", () => {
  it("владелец добавляет свой список в свою группу", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const group = await prisma.listGroup.create({
      data: { userId: user.id, spaceId: user.defaultSpaceId, name: "Дом" },
    });
    setSessionUser(user.id);

    const result = await addListToGroup(
      formData({ groupId: group.id, listId: list.id, spaceId: user.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(await listsInGroup(group.id)).toEqual([list.id]);
  });

  it("редактор добавляет расшаренный список в свою группу", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    // Группа принадлежит редактору в его пространстве.
    const group = await prisma.listGroup.create({
      data: { userId: editor.id, spaceId: editor.defaultSpaceId, name: "Общие" },
    });
    setSessionUser(editor.id);

    const result = await addListToGroup(
      formData({ groupId: group.id, listId: list.id, spaceId: editor.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(await listsInGroup(group.id)).toEqual([list.id]);
  });

  it("нельзя добавить список в чужую группу", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const list = await makeList(other.id, other.defaultSpaceId);
    const group = await prisma.listGroup.create({
      data: { userId: owner.id, spaceId: owner.defaultSpaceId, name: "Owner" },
    });
    setSessionUser(other.id);

    const result = await addListToGroup(
      formData({ groupId: group.id, listId: list.id, spaceId: other.defaultSpaceId }),
    );

    expect(result).toEqual({ success: false, error: "Группа не найдена" });
    expect(await listsInGroup(group.id)).toEqual([]);
  });

  it("нельзя добавить недоступный список в свою группу", async () => {
    const user = await makeUser();
    const stranger = await makeUser();
    const foreignList = await makeList(stranger.id, stranger.defaultSpaceId);
    const group = await prisma.listGroup.create({
      data: { userId: user.id, spaceId: user.defaultSpaceId, name: "Моя" },
    });
    setSessionUser(user.id);

    const result = await addListToGroup(
      formData({ groupId: group.id, listId: foreignList.id, spaceId: user.defaultSpaceId }),
    );

    expect(result).toEqual({ success: false, error: "Список не найден" });
    expect(await listsInGroup(group.id)).toEqual([]);
  });
});

describe("removeListFromGroup", () => {
  it("убирает список из группы, не удаляя сам список", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const group = await prisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: user.defaultSpaceId,
        name: "Дом",
        lists: { connect: { id: list.id } },
      },
    });
    setSessionUser(user.id);

    const result = await removeListFromGroup(
      formData({ groupId: group.id, listId: list.id, spaceId: user.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(await listsInGroup(group.id)).toEqual([]);
    expect(await prisma.list.findUnique({ where: { id: list.id } })).not.toBeNull();
  });
});

describe("персональность и изоляция групп", () => {
  it("один список лежит в группах разных пользователей независимо", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);

    const ownerGroup = await prisma.listGroup.create({
      data: {
        userId: owner.id,
        spaceId: owner.defaultSpaceId,
        name: "У владельца",
        lists: { connect: { id: list.id } },
      },
    });
    const editorGroup = await prisma.listGroup.create({
      data: { userId: editor.id, spaceId: editor.defaultSpaceId, name: "У редактора" },
    });

    // Редактор кладёт тот же список в свою группу.
    setSessionUser(editor.id);
    await addListToGroup(
      formData({ groupId: editorGroup.id, listId: list.id, spaceId: editor.defaultSpaceId }),
    );

    // Обе группы содержат список; они независимы.
    expect(await listsInGroup(ownerGroup.id)).toEqual([list.id]);
    expect(await listsInGroup(editorGroup.id)).toEqual([list.id]);

    // Редактор убирает список из своей группы — у владельца остаётся.
    await removeListFromGroup(
      formData({ groupId: editorGroup.id, listId: list.id, spaceId: editor.defaultSpaceId }),
    );
    expect(await listsInGroup(editorGroup.id)).toEqual([]);
    expect(await listsInGroup(ownerGroup.id)).toEqual([list.id]);
  });

  it("группа из другого пространства не находится", async () => {
    const user = await makeUser();
    const otherSpace = await makeSpace(user.id, "Другое");
    const group = await prisma.listGroup.create({
      data: { userId: user.id, spaceId: user.defaultSpaceId, name: "В default" },
    });
    setSessionUser(user.id);

    // Действие адресовано другому пространству, а группа — в default.
    const result = await renameGroup(
      formData({ groupId: group.id, name: "Новое", spaceId: otherSpace.id }),
    );

    expect(result.success).toBe(false);
    expect(
      (await prisma.listGroup.findUniqueOrThrow({ where: { id: group.id } })).name,
    ).toBe("В default");
  });
});
