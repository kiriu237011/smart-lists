/**
 * @file list-columns.test.ts
 * @description Тесты раскладки карточек по колонкам.
 *
 * Проверяется ровно то, на чём держится вся затея: порядок карточек не
 * меняется, колонок всегда столько, сколько запрошено, а размеры отличаются не
 * больше чем на единицу. Нарушение любого из трёх правил ломает либо порядок
 * чтения, либо выравнивание колонок на экране.
 */

import { describe, expect, it } from "vitest";

import { listsInGroupOrder, splitIntoColumns } from "@/lib/list-columns";

/** Разворачивает колонки обратно в плоский список. */
function flatten<T>(columns: T[][]): T[] {
  return columns.flat();
}

describe("splitIntoColumns", () => {
  it("делит поровну, когда делится нацело", () => {
    expect(splitIntoColumns([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("отдаёт остаток первым колонкам, а не последней", () => {
    expect(splitIntoColumns([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 2, 3],
      [4, 5],
      [6, 7],
    ]);
  });

  it("сохраняет порядок карточек", () => {
    const items = Array.from({ length: 11 }, (_, index) => index);
    expect(flatten(splitIntoColumns(items, 3))).toEqual(items);
  });

  it("всегда возвращает запрошенное число колонок, даже пустых", () => {
    expect(splitIntoColumns([1], 3)).toEqual([[1], [], []]);
    expect(splitIntoColumns([], 3)).toEqual([[], [], []]);
  });

  it("размеры колонок отличаются не больше чем на единицу", () => {
    for (let total = 0; total <= 20; total += 1) {
      const items = Array.from({ length: total }, (_, index) => index);
      const sizes = splitIntoColumns(items, 3).map((column) => column.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it("трактует бессмысленное число колонок как одну", () => {
    expect(splitIntoColumns([1, 2], 0)).toEqual([[1, 2]]);
    expect(splitIntoColumns([1, 2], -3)).toEqual([[1, 2]]);
  });
});

describe("listsInGroupOrder", () => {
  const lists = [
    { id: "new", groups: [{ id: "work", position: 2 }] },
    {
      id: "shared",
      groups: [
        { id: "work", position: 1 },
        { id: "home", position: 3 },
      ],
    },
    { id: "outside", groups: [{ id: "home", position: 1 }] },
  ];

  it("отбирает membership активной группы и сортирует по её позиции", () => {
    expect(listsInGroupOrder(lists, "work").map((list) => list.id)).toEqual([
      "shared",
      "new",
    ]);
  });

  it("не смешивает независимые порядки пересекающихся групп", () => {
    expect(listsInGroupOrder(lists, "home").map((list) => list.id)).toEqual([
      "outside",
      "shared",
    ]);
  });
});
