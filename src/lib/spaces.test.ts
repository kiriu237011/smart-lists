/**
 * @file spaces.test.ts
 * @description Тесты чистых хелперов пространств.
 *
 * `listInSpaceWhere` — единственная точка, через которую задаётся видимость
 * списка. Ошибка в нём означает доступ к чужим данным, поэтому форма фильтра
 * зафиксирована тестом целиком: и ветка владельца, и ветка share обязаны
 * оставаться привязанными к `spaceId`.
 *
 * `@/lib/db` подменяется транзитивно через scoped DB-модуль, а проверяемые
 * здесь функции к базе не обращаются.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: {} }));

const { defaultSpaceId, listInSpaceWhere, normalizeSpaceName } = await import(
  "@/lib/spaces"
);

describe("defaultSpaceId", () => {
  it("строит детерминированный ID из userId", () => {
    expect(defaultSpaceId("user_1")).toBe("space_default_user_1");
  });

  it("возвращает одно и то же значение при повторных вызовах", () => {
    expect(defaultSpaceId("user_1")).toBe(defaultSpaceId("user_1"));
  });

  it("различает пользователей", () => {
    expect(defaultSpaceId("user_1")).not.toBe(defaultSpaceId("user_2"));
  });
});

describe("normalizeSpaceName", () => {
  it("убирает пробелы по краям и приводит к нижнему регистру", () => {
    expect(normalizeSpaceName("  Работа  ")).toBe("работа");
  });

  it("считает одинаковыми имена, различающиеся только регистром", () => {
    expect(normalizeSpaceName("Дом")).toBe(normalizeSpaceName("дом"));
  });

  it("приводит совместимые Unicode-формы к одному виду", () => {
    // NFD: "й" как "и" + комбинирующая краткая. Без NFKC это разные строки.
    expect(normalizeSpaceName("Мой")).toBe(normalizeSpaceName("Мой".normalize("NFD")));
  });

  it("не склеивает внутренние пробелы", () => {
    expect(normalizeSpaceName("список  покупок")).toBe("список  покупок");
  });
});

describe("listInSpaceWhere", () => {
  it("разрешает собственный список и share только в переданном пространстве", () => {
    expect(listInSpaceWhere("user_1", "space_a")).toEqual({
      OR: [
        { ownerId: "user_1", spaceId: "space_a" },
        { shares: { some: { userId: "user_1", spaceId: "space_a" } } },
      ],
    });
  });

  it("привязывает ветку владельца к пространству, а не только к владельцу", () => {
    const where = listInSpaceWhere("user_1", "space_a");
    const ownerBranch = where.OR as Array<Record<string, unknown>>;

    expect(ownerBranch[0]).toHaveProperty("spaceId", "space_a");
  });

  it("привязывает ветку share к получателю и его пространству", () => {
    const where = listInSpaceWhere("user_1", "space_a");
    const shareBranch = (where.OR as Array<Record<string, unknown>>)[1];

    expect(shareBranch).toEqual({
      shares: { some: { userId: "user_1", spaceId: "space_a" } },
    });
  });

  it("не содержит веток без ограничения по пользователю", () => {
    const where = listInSpaceWhere("user_1", "space_a");
    const branches = where.OR as Array<Record<string, unknown>>;

    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      const mentionsUser =
        JSON.stringify(branch).includes('"ownerId":"user_1"') ||
        JSON.stringify(branch).includes('"userId":"user_1"');
      expect(mentionsUser).toBe(true);
    }
  });
});
