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
  moveGroup,
  moveListInGroup,
  removeListFromGroup,
  renameGroup,
} from "@/app/actions";
import { prisma, setSessionUser } from "./setup";
import { formData, makeList, makeSpace, makeUser, shareList } from "./factories";

/** ID списков, входящих в группу. */
async function listsInGroup(groupId: string): Promise<string[]> {
  const memberships = await prisma.listGroupMembership.findMany({
    where: { groupId },
    select: { listId: true },
  });
  return memberships.map((membership) => membership.listId).sort();
}

/** Названия списков в сохранённом порядке конкретной группы. */
async function listNamesInGroup(groupId: string): Promise<string[]> {
  const memberships = await prisma.listGroupMembership.findMany({
    where: { groupId },
    orderBy: [{ position: "asc" }, { listId: "asc" }],
    select: { list: { select: { title: true } } },
  });
  return memberships.map((membership) => membership.list.title);
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
      data: { userId: user.id, spaceId: user.defaultSpaceId, name: "Дом", position: 1 },
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
      data: { userId: owner.id, spaceId: owner.defaultSpaceId, name: "Дом", position: 1 },
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
        position: 1,
      },
    });
    await prisma.listGroupMembership.create({
      data: { groupId: group.id, listId: list.id, position: 1 },
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
      data: { userId: user.id, spaceId: user.defaultSpaceId, name: "Старое", position: 1 },
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
      data: { userId: owner.id, spaceId: owner.defaultSpaceId, name: "Owner", position: 1 },
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

describe("moveGroup", () => {
  it("перемещает группу между строками порядка и сохраняет позицию", async () => {
    const user = await makeUser();
    const [home, work, archive] = await Promise.all([
      prisma.listGroup.create({
        data: {
          userId: user.id,
          spaceId: user.defaultSpaceId,
          name: "Дом",
          position: 1,
        },
      }),
      prisma.listGroup.create({
        data: {
          userId: user.id,
          spaceId: user.defaultSpaceId,
          name: "Работа",
          position: 2,
        },
      }),
      prisma.listGroup.create({
        data: {
          userId: user.id,
          spaceId: user.defaultSpaceId,
          name: "Архив",
          position: 3,
        },
      }),
    ]);
    setSessionUser(user.id);

    const result = await moveGroup(
      formData({
        groupId: archive.id,
        previousGroupId: "",
        nextGroupId: home.id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    const ordered = await prisma.listGroup.findMany({
      where: { userId: user.id, spaceId: user.defaultSpaceId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { name: true },
    });
    expect(ordered.map((group) => group.name)).toEqual([
      "Архив",
      "Дом",
      "Работа",
    ]);
    expect(work.position).toBe(2);
  });

  it("атомарно перенумеровывает группы при исчерпании точности позиции", async () => {
    const user = await makeUser();
    const [first, second, moving] = await Promise.all([
      prisma.listGroup.create({
        data: {
          userId: user.id,
          spaceId: user.defaultSpaceId,
          name: "Первая",
          position: 1,
        },
      }),
      prisma.listGroup.create({
        data: {
          userId: user.id,
          spaceId: user.defaultSpaceId,
          name: "Вторая",
          position: 1 + Number.EPSILON,
        },
      }),
      prisma.listGroup.create({
        data: {
          userId: user.id,
          spaceId: user.defaultSpaceId,
          name: "Перемещаемая",
          position: 3,
        },
      }),
    ]);
    setSessionUser(user.id);

    const result = await moveGroup(
      formData({
        groupId: moving.id,
        previousGroupId: first.id,
        nextGroupId: second.id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    const ordered = await prisma.listGroup.findMany({
      where: { userId: user.id, spaceId: user.defaultSpaceId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, position: true },
    });
    expect(ordered).toEqual([
      { id: first.id, position: 1 },
      { id: moving.id, position: 2 },
      { id: second.id, position: 3 },
    ]);
  });

  it("отклоняет устаревшую пару соседей без частичного обновления", async () => {
    const user = await makeUser();
    const groups = await Promise.all(
      ["Дом", "Работа", "Архив"].map((name, index) =>
        prisma.listGroup.create({
          data: {
            userId: user.id,
            spaceId: user.defaultSpaceId,
            name,
            position: index + 1,
          },
        }),
      ),
    );
    setSessionUser(user.id);

    const result = await moveGroup(
      formData({
        groupId: groups[1].id,
        previousGroupId: groups[0].id,
        nextGroupId: "",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "stale" });
    const positions = await prisma.listGroup.findMany({
      where: { userId: user.id },
      orderBy: { position: "asc" },
      select: { name: true },
    });
    expect(positions.map((group) => group.name)).toEqual([
      "Дом",
      "Работа",
      "Архив",
    ]);
  });

  it("не перемещает группу другого пользователя", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const group = await prisma.listGroup.create({
      data: {
        userId: owner.id,
        spaceId: owner.defaultSpaceId,
        name: "Чужая",
        position: 1,
      },
    });
    setSessionUser(other.id);

    const result = await moveGroup(
      formData({
        groupId: group.id,
        previousGroupId: "",
        nextGroupId: "",
        spaceId: other.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "Группа не найдена" });
    expect(
      (await prisma.listGroup.findUniqueOrThrow({ where: { id: group.id } }))
        .position,
    ).toBe(1);
  });
});

describe("addListToGroup", () => {
  it("владелец добавляет свой список в свою группу", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const group = await prisma.listGroup.create({
      data: { userId: user.id, spaceId: user.defaultSpaceId, name: "Дом", position: 1 },
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
      data: { userId: editor.id, spaceId: editor.defaultSpaceId, name: "Общие", position: 1 },
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
      data: { userId: owner.id, spaceId: owner.defaultSpaceId, name: "Owner", position: 1 },
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
      data: { userId: user.id, spaceId: user.defaultSpaceId, name: "Моя", position: 1 },
    });
    setSessionUser(user.id);

    const result = await addListToGroup(
      formData({ groupId: group.id, listId: foreignList.id, spaceId: user.defaultSpaceId }),
    );

    expect(result).toEqual({ success: false, error: "Список не найден" });
    expect(await listsInGroup(group.id)).toEqual([]);
  });
});

describe("moveListInGroup", () => {
  it("меняет порядок только в выбранной группе", async () => {
    const user = await makeUser();
    const [firstGroup, secondGroup] = await Promise.all(
      ["Первая", "Вторая"].map((name, index) =>
        prisma.listGroup.create({
          data: {
            userId: user.id,
            spaceId: user.defaultSpaceId,
            name,
            position: index + 1,
          },
        }),
      ),
    );
    const lists = await Promise.all(
      ["A", "B", "C"].map((title) =>
        makeList(user.id, user.defaultSpaceId, { title }),
      ),
    );
    await prisma.listGroupMembership.createMany({
      data: [firstGroup, secondGroup].flatMap((group) =>
        lists.map((list, index) => ({
          groupId: group.id,
          listId: list.id,
          position: index + 1,
        })),
      ),
    });
    setSessionUser(user.id);

    const result = await moveListInGroup(
      formData({
        groupId: firstGroup.id,
        listId: lists[2].id,
        previousListId: "",
        nextListId: lists[0].id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    expect(await listNamesInGroup(firstGroup.id)).toEqual(["C", "A", "B"]);
    expect(await listNamesInGroup(secondGroup.id)).toEqual(["A", "B", "C"]);
  });

  it("отклоняет устаревший разрыв без частичного обновления", async () => {
    const user = await makeUser();
    const group = await prisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: user.defaultSpaceId,
        name: "Дом",
        position: 1,
      },
    });
    const lists = await Promise.all(
      ["A", "B", "C"].map((title) =>
        makeList(user.id, user.defaultSpaceId, { title }),
      ),
    );
    await prisma.listGroupMembership.createMany({
      data: lists.map((list, index) => ({
        groupId: group.id,
        listId: list.id,
        position: index + 1,
      })),
    });
    setSessionUser(user.id);

    const result = await moveListInGroup(
      formData({
        groupId: group.id,
        listId: lists[1].id,
        previousListId: lists[0].id,
        nextListId: "",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "stale" });
    expect(await listNamesInGroup(group.id)).toEqual(["A", "B", "C"]);
  });

  it("перенумеровывает только одну группу при исчерпании точности", async () => {
    const user = await makeUser();
    const group = await prisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: user.defaultSpaceId,
        name: "Точная",
        position: 1,
      },
    });
    const lists = await Promise.all(
      ["A", "B", "C"].map((title) =>
        makeList(user.id, user.defaultSpaceId, { title }),
      ),
    );
    await prisma.listGroupMembership.createMany({
      data: [
        { groupId: group.id, listId: lists[0].id, position: 1 },
        { groupId: group.id, listId: lists[1].id, position: 2 },
        { groupId: group.id, listId: lists[2].id, position: 3 },
      ],
    });
    // Соседний double выставляем литералом в SQL, а не параметром Prisma.
    // Prisma сериализует числовые параметры примерно с 16 значащими цифрами,
    // поэтому `1 + Number.EPSILON` (17 цифр) доезжал до колонки как ровно 1.
    // Позиции A и B совпадали, порядок начинал решать тайбрейк по `createdAt`,
    // а списки создаются конкурентно — и тест падал в четверти прогонов из-за
    // того, какая вставка закоммитилась первой. Литерал Postgres разбирает
    // точно, позиции остаются различимы, и середина между ними совпадает с
    // границей — то самое исчерпание точности, ради которого тест и написан.
    await prisma.$executeRawUnsafe(
      `UPDATE "_ListGroupMembers" SET position = 1.0000000000000002 WHERE "A" = $1 AND "B" = $2`,
      lists[1].id,
      group.id,
    );
    setSessionUser(user.id);

    const result = await moveListInGroup(
      formData({
        groupId: group.id,
        listId: lists[2].id,
        previousListId: lists[0].id,
        nextListId: lists[1].id,
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    expect(await listNamesInGroup(group.id)).toEqual(["A", "C", "B"]);
    const positions = await prisma.listGroupMembership.findMany({
      where: { groupId: group.id },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    expect(positions.map((membership) => membership.position)).toEqual([1, 2, 3]);
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
        position: 1,
      },
    });
    await prisma.listGroupMembership.create({
      data: { groupId: group.id, listId: list.id, position: 1 },
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
        position: 1,
      },
    });
    await prisma.listGroupMembership.create({
      data: { groupId: ownerGroup.id, listId: list.id, position: 1 },
    });
    const editorGroup = await prisma.listGroup.create({
      data: {
        userId: editor.id,
        spaceId: editor.defaultSpaceId,
        name: "У редактора",
        position: 1,
      },
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
      data: {
        userId: user.id,
        spaceId: user.defaultSpaceId,
        name: "В default",
        position: 1,
      },
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
