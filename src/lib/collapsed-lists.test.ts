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
  parseCollapsedLists,
  pruneCollapsedLists,
  serializeCollapsedLists,
  toggleCollapsedList,
} from "@/lib/collapsed-lists";

describe("parseCollapsedLists", () => {
  it("читает сохранённый массив ID", () => {
    expect(parseCollapsedLists('["a","b"]')).toEqual(new Set(["a", "b"]));
  });

  it("возвращает пустой набор, если ключа нет", () => {
    expect(parseCollapsedLists(null)).toEqual(new Set());
  });

  it("возвращает пустой набор на битом JSON", () => {
    expect(parseCollapsedLists('["a","b')).toEqual(new Set());
  });

  it("возвращает пустой набор, если сохранён не массив", () => {
    expect(parseCollapsedLists('{"a":true}')).toEqual(new Set());
    expect(parseCollapsedLists('"a"')).toEqual(new Set());
  });

  it("отбрасывает нестроковые и пустые элементы, сохраняя остальные", () => {
    expect(parseCollapsedLists('["a",1,null,"",{"id":"b"},"c"]')).toEqual(
      new Set(["a", "c"]),
    );
  });

  it("схлопывает повторы", () => {
    expect(parseCollapsedLists('["a","a"]')).toEqual(new Set(["a"]));
  });
});

describe("serializeCollapsedLists", () => {
  it("пишет массив ID", () => {
    expect(serializeCollapsedLists(new Set(["a", "b"]))).toBe('["a","b"]');
  });

  it("переживает круговой обход без потерь", () => {
    const ids = new Set(["a", "b", "c"]);
    expect(parseCollapsedLists(serializeCollapsedLists(ids))).toEqual(ids);
  });
});

describe("toggleCollapsedList", () => {
  it("добавляет отсутствующий ID", () => {
    expect(toggleCollapsedList(new Set(["a"]), "b")).toEqual(new Set(["a", "b"]));
  });

  it("убирает присутствующий ID", () => {
    expect(toggleCollapsedList(new Set(["a", "b"]), "a")).toEqual(new Set(["b"]));
  });

  it("не мутирует исходный набор", () => {
    const ids = new Set(["a"]);
    toggleCollapsedList(ids, "b");
    expect(ids).toEqual(new Set(["a"]));
  });
});

describe("pruneCollapsedLists", () => {
  it("убирает ID удалённых списков", () => {
    expect(pruneCollapsedLists(new Set(["a", "b"]), ["b", "c"])).toEqual(
      new Set(["b"]),
    );
  });

  it("возвращает тот же набор, если отсеивать нечего", () => {
    const ids = new Set(["a", "b"]);
    expect(pruneCollapsedLists(ids, ["a", "b", "c"])).toBe(ids);
  });

  it("возвращает тот же пустой набор, не обходя выборку", () => {
    const ids = new Set<string>();
    expect(pruneCollapsedLists(ids, ["a"])).toBe(ids);
  });

  it("очищает набор, если ни одного списка не осталось", () => {
    expect(pruneCollapsedLists(new Set(["a"]), [])).toEqual(new Set());
  });
});
