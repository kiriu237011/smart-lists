/**
 * @file insights.int.test.ts
 * @description Контекст, уезжающий во внешний AI-сервис.
 *
 * Сам сервис не поднимается — проверяется ровно то, что формирует приложение:
 * какие записи попали в запрос, в каком виде и что сказано в `notes_meta`.
 * Это единственная часть AI-потока, которая ломается тихо: ответ модели всё
 * равно придёт, просто он будет построен не по тем данным.
 *
 * `fetch` подменяется шпионом: настоящий вызов ушёл бы в сеть, а нам нужен
 * только его аргумент.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getListInsight } from "@/app/actions/insights";
import { MAX_INSIGHT_ITEMS } from "@/lib/notes";
import { prisma, setSessionUser } from "./setup";
import { makeItem, makeList, makeUser } from "./factories";

/** Форма запроса к сервису — ровно то, что проверяют тесты. */
type InsightRequest = {
  title: string;
  list_note: string | null;
  items: Array<{
    name: string;
    is_completed: boolean;
    note: string | null;
    sub_items: Array<{ name: string; is_completed: boolean; note: string | null }>;
  }>;
  notes_meta: {
    list_note_included: boolean;
    included_item_notes: number;
    omitted_item_notes: number;
  };
  user_message: string | null;
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.INSIGHTS_SERVICE_URL = "https://insights.test";
  process.env.INSIGHTS_SERVICE_SECRET = "test-secret";

  fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ insight: "ok" }),
  }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Тело последнего запроса к сервису. */
function lastRequest(): InsightRequest {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
  return JSON.parse(init.body) as InsightRequest;
}

describe("контекст AI — уровни", () => {
  it("шлёт подпункты вложенными, а не отдельными записями", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId, { title: "Ужин" });
    const parent = await makeItem(list.id, { name: "Приготовить" });
    await makeItem(list.id, { name: "Купить продукты", parentId: parent.id });
    await makeItem(list.id, { name: "Нарезать салат", parentId: parent.id });
    await makeItem(list.id, { name: "Убрать со стола" });
    setSessionUser(user.id);

    const result = await getListInsight(list.id, undefined, user.defaultSpaceId);
    expect(result.error).toBeUndefined();

    const request = lastRequest();
    expect(request.items.map((item) => item.name)).toEqual([
      "Приготовить",
      "Убрать со стола",
    ]);
    expect(request.items[0].sub_items.map((subItem) => subItem.name)).toEqual([
      "Купить продукты",
      "Нарезать салат",
    ]);
    expect(request.items[1].sub_items).toEqual([]);
  });

  it("отметка пункта считается по подпунктам, а не по полю строки", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    // Кеш в строке намеренно расходится с подпунктами: в контексте для модели
    // ему доверять незачем.
    const parent = await makeItem(list.id, { name: "Ужин", isCompleted: true });
    await makeItem(list.id, {
      name: "Купить",
      parentId: parent.id,
      isCompleted: true,
    });
    await makeItem(list.id, { name: "Готовить", parentId: parent.id });
    setSessionUser(user.id);

    await getListInsight(list.id, undefined, user.defaultSpaceId);

    const [item] = lastRequest().items;
    expect(item.is_completed).toBe(false);
    // Порядок тот же, что видит пользователь: невыполненные сверху.
    expect(
      item.sub_items.map((subItem) => [subItem.name, subItem.is_completed]),
    ).toEqual([
      ["Готовить", false],
      ["Купить", true],
    ]);
  });

  it("подпункты не расходуют лимит пунктов", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    await prisma.item.createMany({
      data: Array.from({ length: MAX_INSIGHT_ITEMS }, (_, index) => ({
        listId: list.id,
        name: `Пункт ${index + 1}`,
        position: index + 1,
      })),
    });
    const first = await prisma.item.findFirstOrThrow({
      where: { listId: list.id, name: "Пункт 1" },
    });
    await makeItem(list.id, { name: "Подпункт", parentId: first.id });
    setSessionUser(user.id);

    await getListInsight(list.id, undefined, user.defaultSpaceId);

    const request = lastRequest();
    expect(request.items).toHaveLength(MAX_INSIGHT_ITEMS);
    expect(request.items[0].sub_items).toHaveLength(1);
  });

  it("подпункт без своего пункта в контекст не попадает", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    await prisma.item.createMany({
      data: Array.from({ length: MAX_INSIGHT_ITEMS }, (_, index) => ({
        listId: list.id,
        name: `Пункт ${index + 1}`,
        position: index + 1,
      })),
    });
    // Этот пункт за пределами лимита, значит и его подпункт бессмысленнен.
    const extra = await makeItem(list.id, {
      name: "Лишний",
      position: MAX_INSIGHT_ITEMS + 1,
    });
    await makeItem(list.id, { name: "Его подпункт", parentId: extra.id });
    setSessionUser(user.id);

    await getListInsight(list.id, undefined, user.defaultSpaceId);

    const request = lastRequest();
    expect(request.items.map((item) => item.name)).not.toContain("Лишний");
    expect(
      request.items.flatMap((item) => item.sub_items.map((s) => s.name)),
    ).not.toContain("Его подпункт");
  });
});

describe("контекст AI — заметки", () => {
  it("заметка подпункта уезжает вместе с ним и попадает в счётчик", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const parent = await makeItem(list.id, { name: "Ужин" });
    const subItem = await makeItem(list.id, {
      name: "Купить",
      parentId: parent.id,
    });
    await prisma.item.update({
      where: { id: subItem.id },
      data: { note: "Взять безлактозное", noteUpdatedAt: new Date() },
    });
    setSessionUser(user.id);

    await getListInsight(list.id, undefined, user.defaultSpaceId);

    const request = lastRequest();
    expect(request.items[0].sub_items[0].note).toBe("Взять безлактозное");
    expect(request.notes_meta.included_item_notes).toBe(1);
    expect(request.notes_meta.omitted_item_notes).toBe(0);
  });

  it("заметка отброшенного подпункта считается пропущенной", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    await prisma.item.createMany({
      data: Array.from({ length: MAX_INSIGHT_ITEMS }, (_, index) => ({
        listId: list.id,
        name: `Пункт ${index + 1}`,
        position: index + 1,
      })),
    });
    const extra = await makeItem(list.id, {
      name: "Лишний",
      position: MAX_INSIGHT_ITEMS + 1,
    });
    const subItem = await makeItem(list.id, {
      name: "Его подпункт",
      parentId: extra.id,
    });
    await prisma.item.update({
      where: { id: subItem.id },
      data: { note: "Не уедет", noteUpdatedAt: new Date() },
    });
    setSessionUser(user.id);

    await getListInsight(list.id, undefined, user.defaultSpaceId);

    // Заметка вошла в символьный бюджет, но в запрос не попала: сообщение
    // пользователю должно говорить о фактически отправленном.
    const request = lastRequest();
    expect(request.notes_meta.included_item_notes).toBe(0);
    expect(request.notes_meta.omitted_item_notes).toBe(1);
  });
});
