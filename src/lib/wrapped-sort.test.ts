import type { ClientRect } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import {
  getWrappedSortTransforms,
  type WrappedSortLayout,
} from "@/lib/wrapped-sort";

const layout: WrappedSortLayout = {
  right: 442,
  wrappedRowLeft: 18,
  columnGap: 8,
  rowGap: 8,
};

function rect(left: number, top: number, width: number): ClientRect {
  return {
    bottom: top + 28,
    height: 28,
    left,
    right: left + width,
    top,
    width,
  };
}

const rects = [
  rect(65, 0, 104),
  rect(177, 0, 88),
  rect(273, 0, 95),
  rect(18, 36, 125),
  rect(151, 36, 160),
  rect(18, 72, 130),
];

describe("getWrappedSortTransforms", () => {
  it("пересчитывает переносы с исходными ширинами без перекрытия соседей", () => {
    const transforms = getWrappedSortTransforms(rects, 5, 1, layout);
    const visualRects = rects.map((source, index) => ({
      left: source.left + transforms[index]!.x,
      right: source.right + transforms[index]!.x,
      top: source.top + transforms[index]!.y,
    }));

    // Новый порядок: 0, 5, 1, 2, 3, 4.
    const order = [0, 5, 1, 2, 3, 4];
    for (let index = 1; index < order.length; index += 1) {
      const previous = visualRects[order[index - 1]];
      const current = visualRects[order[index]];
      if (previous.top === current.top) {
        expect(current.left - previous.right).toBe(layout.columnGap);
      } else {
        expect(current.left).toBe(layout.wrappedRowLeft);
        expect(current.top).toBeGreaterThan(previous.top);
      }
    }

    expect(transforms.every((transform) => transform?.scaleX === 1)).toBe(true);
    expect(transforms.every((transform) => transform?.scaleY === 1)).toBe(true);
  });

  it("возвращает пустые трансформации при устаревших индексах", () => {
    expect(getWrappedSortTransforms(rects, 99, 0, layout)).toEqual(
      rects.map(() => null),
    );
  });
});
