/**
 * @file item-drop.test.ts
 * @description Тесты геометрии переноса записи в другой список жестом.
 *
 * Проверяются обе чистые функции модуля. DOM-часть (`captureDropTargets`,
 * `setDropHighlight`) остаётся за юнитами: она тривиальна ровно настолько,
 * насколько верна геометрия, которую проверяет этот файл, а её собственное
 * поведение видно только в E2E.
 */

import { describe, expect, it } from "vitest";

import {
  listIdAtPoint,
  pointerPoint,
  type DropTargets,
} from "@/lib/item-drop";

/** Две карточки рядом: левая и правая колонки одной высоты. */
const targets: DropTargets = {
  boxes: [
    { listId: "left", left: 0, top: 100, right: 200, bottom: 300 },
    { listId: "right", left: 220, top: 100, right: 420, bottom: 300 },
  ],
  scroll: { x: 0, y: 0 },
};

/** Прокрутка на момент снимка — она же текущая, пока страницу не двигали. */
const noScroll = { x: 0, y: 0 };

describe("pointerPoint", () => {
  it("берёт координаты окна из pointer-события", () => {
    expect(pointerPoint({ clientX: 12, clientY: 34 })).toEqual({ x: 12, y: 34 });
  });

  it("берёт последнее касание из touch-события", () => {
    expect(pointerPoint({ changedTouches: [{ clientX: 5, clientY: 7 }] })).toEqual({
      x: 5,
      y: 7,
    });
  });

  it("предпочитает changedTouches: у touchend своих координат нет", () => {
    expect(
      pointerPoint({
        clientX: 0,
        clientY: 0,
        changedTouches: [{ clientX: 5, clientY: 7 }],
      }),
    ).toEqual({ x: 5, y: 7 });
  });

  it("возвращает null, когда координат в событии нет", () => {
    expect(pointerPoint({})).toBeNull();
    expect(pointerPoint({ changedTouches: [] })).toBeNull();
  });
});

describe("listIdAtPoint", () => {
  it("находит карточку под указателем", () => {
    expect(listIdAtPoint(targets, { x: 100, y: 200 }, noScroll)).toBe("left");
    expect(listIdAtPoint(targets, { x: 300, y: 200 }, noScroll)).toBe("right");
  });

  it("возвращает null в промежутке между карточками", () => {
    expect(listIdAtPoint(targets, { x: 210, y: 200 }, noScroll)).toBeNull();
    expect(listIdAtPoint(targets, { x: 100, y: 50 }, noScroll)).toBeNull();
  });

  it("считает границу карточки попаданием", () => {
    expect(listIdAtPoint(targets, { x: 0, y: 100 }, noScroll)).toBe("left");
    expect(listIdAtPoint(targets, { x: 420, y: 300 }, noScroll)).toBe("right");
  });

  it("не отдаёт цель при пустом снимке", () => {
    expect(
      listIdAtPoint({ boxes: [], scroll: noScroll }, { x: 100, y: 200 }, noScroll),
    ).toBeNull();
  });

  it("учитывает прокрутку страницы посреди жеста", () => {
    // Страницу прокрутили на 150 вниз: карточка уехала вверх, и точка,
    // попадавшая в неё раньше, теперь ниже её нижнего края.
    const scrolled = { x: 0, y: 150 };

    expect(listIdAtPoint(targets, { x: 100, y: 200 }, scrolled)).toBeNull();
    // А попадает в неё теперь точка, поднявшаяся на те же 150.
    expect(listIdAtPoint(targets, { x: 100, y: 50 }, scrolled)).toBe("left");
  });

  it("учитывает горизонтальную прокрутку", () => {
    const scrolled = { x: 100, y: 0 };

    expect(listIdAtPoint(targets, { x: 150, y: 200 }, scrolled)).toBe("right");
  });
});
