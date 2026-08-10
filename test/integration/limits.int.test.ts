/**
 * @file limits.int.test.ts
 * @description Структурные потолки на количество сущностей.
 *
 * Потолки заданы числами, при которых человек их не встретит, поэтому тесты
 * не наполняют контейнер до боевого значения — они создают ровно `MAX`
 * дешёвыми `createMany` и проверяют границу. Проверяется именно граница:
 * последняя разрешённая операция проходит, следующая отказывает.
 */

import { describe, expect, it } from "vitest";

import {
  addItem,
  createGroup,
  createList,
  moveItemToList,
} from "@/app/actions";
import {
  MAX_GROUPS_PER_SPACE,
  MAX_ITEMS_PER_LIST,
  MAX_LISTS_PER_SPACE,
  MAX_SUB_ITEMS_PER_ITEM,
} from "@/lib/limits";
import { prisma, setSessionUser } from "./setup";
import { formData, makeItem, makeList, makeUser } from "./factories";

/** Пункты верхнего уровня одним запросом — наполнение списка до потолка. */
async function fillList(listId: string, count: number, parentId?: string) {
  await prisma.item.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      listId,
      parentId: parentId ?? null,
      name: `Запись ${index}`,
      position: index + 1,
    })),
  });
}

describe("потолок списков в пространстве", () => {
  it("отказывает на превышении и пускает ровно до потолка", async () => {
    const user = await makeUser();
    setSessionUser(user.id);

    await prisma.list.createMany({
      data: Array.from({ length: MAX_LISTS_PER_SPACE - 1 }, (_, index) => ({
        title: `Список ${index}`,
        ownerId: user.id,
        spaceId: user.defaultSpaceId,
      })),
    });

    const last = await createList(
      formData({ title: "Последний", spaceId: user.defaultSpaceId }),
    );
    expect(last.success).toBe(true);

    const overflow = await createList(
      formData({ title: "Лишний", spaceId: user.defaultSpaceId }),
    );
    expect(overflow).toEqual({ success: false, error: "listLimitReached" });
  });

  it("считает списки своего пространства, а не все подряд", async () => {
    const user = await makeUser();
    const other = await prisma.space.create({
      data: { userId: user.id, name: "Второе", normalizedName: "второе" },
    });
    setSessionUser(user.id);

    await prisma.list.createMany({
      data: Array.from({ length: MAX_LISTS_PER_SPACE }, (_, index) => ({
        title: `Список ${index}`,
        ownerId: user.id,
        spaceId: user.defaultSpaceId,
      })),
    });

    // Первое пространство заполнено, второе пусто — потолок пространственный.
    const created = await createList(
      formData({ title: "В другом пространстве", spaceId: other.id }),
    );
    expect(created.success).toBe(true);
  });
});

describe("потолок групп в пространстве", () => {
  it("отказывает на превышении", async () => {
    const user = await makeUser();
    setSessionUser(user.id);

    await prisma.listGroup.createMany({
      data: Array.from({ length: MAX_GROUPS_PER_SPACE }, (_, index) => ({
        name: `Группа ${index}`,
        userId: user.id,
        spaceId: user.defaultSpaceId,
        position: index + 1,
      })),
    });

    const result = await createGroup(
      formData({ name: "Лишняя", spaceId: user.defaultSpaceId }),
    );
    expect(result).toEqual({ success: false, error: "groupLimitReached" });
  });
});

describe("потолок пунктов в списке", () => {
  it("отказывает на превышении и пускает ровно до потолка", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    await fillList(list.id, MAX_ITEMS_PER_LIST - 1);

    const last = await addItem(
      formData({
        itemName: "Последняя",
        listId: list.id,
        spaceId: user.defaultSpaceId,
      }),
    );
    expect(last.success).toBe(true);

    const overflow = await addItem(
      formData({
        itemName: "Лишняя",
        listId: list.id,
        spaceId: user.defaultSpaceId,
      }),
    );
    expect(overflow).toEqual({ success: false, error: "itemLimitReached" });
  });

  it("считает только верхний уровень: подпункты в потолок не входят", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const parent = await makeItem(list.id, { name: "Родитель" });
    setSessionUser(user.id);

    // Список почти полон подпунктами — на потолок верхнего уровня это не влияет.
    await fillList(list.id, MAX_ITEMS_PER_LIST, parent.id);

    const result = await addItem(
      formData({
        itemName: "Обычный пункт",
        listId: list.id,
        spaceId: user.defaultSpaceId,
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe("потолок подпунктов у пункта", () => {
  it("отказывает на превышении", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const parent = await makeItem(list.id, { name: "Родитель" });
    setSessionUser(user.id);

    await fillList(list.id, MAX_SUB_ITEMS_PER_ITEM, parent.id);

    const result = await addItem(
      formData({
        itemName: "Лишний подпункт",
        listId: list.id,
        parentItemId: parent.id,
        spaceId: user.defaultSpaceId,
      }),
    );
    expect(result).toEqual({ success: false, error: "subItemLimitReached" });
  });

  it("потолок у каждого родителя свой", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const full = await makeItem(list.id, { name: "Полный" });
    const empty = await makeItem(list.id, { name: "Пустой" });
    setSessionUser(user.id);

    await fillList(list.id, MAX_SUB_ITEMS_PER_ITEM, full.id);

    const result = await addItem(
      formData({
        itemName: "Подпункт другого родителя",
        listId: list.id,
        parentItemId: empty.id,
        spaceId: user.defaultSpaceId,
      }),
    );
    expect(result.success).toBe(true);
  });
});

describe("перенос в заполненный список", () => {
  it("отказывает, хотя строк в базе не прибавляется", async () => {
    const user = await makeUser();
    const source = await makeList(user.id, user.defaultSpaceId, {
      title: "Источник",
    });
    const target = await makeList(user.id, user.defaultSpaceId, {
      title: "Цель",
    });
    const item = await makeItem(source.id, { name: "Переезжает" });
    setSessionUser(user.id);

    await fillList(target.id, MAX_ITEMS_PER_LIST);

    const result = await moveItemToList(
      formData({
        itemId: item.id,
        targetListId: target.id,
        mode: "move",
        spaceId: user.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: false, error: "itemLimitReached" });
    // Запись осталась на месте: отказ произошёл до изменения.
    const unchanged = await prisma.item.findUnique({
      where: { id: item.id },
      select: { listId: true },
    });
    expect(unchanged?.listId).toBe(source.id);
  });
});
