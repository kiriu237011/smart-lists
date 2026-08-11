/**
 * @file collapsed-lists.test.ts
 * @description Тесты набора свёрнутых карточек списков.
 *
 * Значение приходит из localStorage, то есть из недоверенного источника:
 * его мог записать прошлый формат хранения или пользователь через консоль.
 * Поэтому разбор проверяется на всех видах мусора — исключение при гидрации
 * уронило бы весь контейнер списков ради настройки отображения.
 */

import { describe, expect, it } from "vitest";

import {
  parseCollapsedIds,
  pruneCollapsedIds,
  serializeCollapsedIds,
  toggleCollapsedId,
} from "@/lib/collapsed-ids";

describe("parseCollapsedIds", () => {
  it("читает сохранённый массив ID", () => {
    expect(parseCollapsedIds('["a","b"]')).toEqual(new Set(["a", "b"]));
  });

  it("возвращает пустой набор, если ключа нет", () => {
    expect(parseCollapsedIds(null)).toEqual(new Set());
  });

  it("возвращает пустой набор на битом JSON", () => {
    expect(parseCollapsedIds('["a","b')).toEqual(new Set());
  });

  it("возвращает пустой набор, если сохранён не массив", () => {
    expect(parseCollapsedIds('{"a":true}')).toEqual(new Set());
    expect(parseCollapsedIds('"a"')).toEqual(new Set());
  });

  it("отбрасывает нестроковые и пустые элементы, сохраняя остальные", () => {
    expect(parseCollapsedIds('["a",1,null,"",{"id":"b"},"c"]')).toEqual(
      new Set(["a", "c"]),
    );
  });

  it("схлопывает повторы", () => {
    expect(parseCollapsedIds('["a","a"]')).toEqual(new Set(["a"]));
  });
});

describe("serializeCollapsedIds", () => {
  it("пишет массив ID", () => {
    expect(serializeCollapsedIds(new Set(["a", "b"]))).toBe('["a","b"]');
  });

  it("переживает круговой обход без потерь", () => {
    const ids = new Set(["a", "b", "c"]);
    expect(parseCollapsedIds(serializeCollapsedIds(ids))).toEqual(ids);
  });
});

describe("toggleCollapsedId", () => {
  it("добавляет отсутствующий ID", () => {
    expect(toggleCollapsedId(new Set(["a"]), "b")).toEqual(new Set(["a", "b"]));
  });

  it("убирает присутствующий ID", () => {
    expect(toggleCollapsedId(new Set(["a", "b"]), "a")).toEqual(new Set(["b"]));
  });

  it("не мутирует исходный набор", () => {
    const ids = new Set(["a"]);
    toggleCollapsedId(ids, "b");
    expect(ids).toEqual(new Set(["a"]));
  });
});

describe("pruneCollapsedIds", () => {
  it("убирает ID удалённых списков", () => {
    expect(pruneCollapsedIds(new Set(["a", "b"]), ["b", "c"])).toEqual(
      new Set(["b"]),
    );
  });

  it("возвращает тот же набор, если отсеивать нечего", () => {
    const ids = new Set(["a", "b"]);
    expect(pruneCollapsedIds(ids, ["a", "b", "c"])).toBe(ids);
  });

  it("возвращает тот же пустой набор, не обходя выборку", () => {
    const ids = new Set<string>();
    expect(pruneCollapsedIds(ids, ["a"])).toBe(ids);
  });

  it("очищает набор, если ни одного списка не осталось", () => {
    expect(pruneCollapsedIds(new Set(["a"]), [])).toEqual(new Set());
  });
});
