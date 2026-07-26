import type { ClientRect } from "@dnd-kit/core";
import type { Transform } from "@dnd-kit/utilities";

export type WrappedSortLayout = {
  /** Правая граница контентной области ленты. */
  right: number;
  /** Левая граница строк после первой (первая начинается после вкладки «Все»). */
  wrappedRowLeft: number;
  columnGap: number;
  rowGap: number;
};

/**
 * Рассчитывает позиции элементов после перестановки в многострочной flex-ленте.
 *
 * Стандартная rectSortingStrategy распределяет элементы по уже существующим
 * прямоугольникам и масштабирует их под ширину соседа. Если scale убрать ради
 * читаемого текста, элементы разной ширины начинают перекрываться. Здесь
 * целевая раскладка строится заново с исходными ширинами и теми же gap/границами,
 * поэтому каждому элементу достаточно обычного translate без деформации.
 */
export function getWrappedSortTransforms(
  rects: ClientRect[],
  activeIndex: number,
  overIndex: number,
  layout: WrappedSortLayout,
): Array<Transform | null> {
  if (
    rects.length === 0 ||
    activeIndex < 0 ||
    activeIndex >= rects.length ||
    overIndex < 0 ||
    overIndex >= rects.length
  ) {
    return rects.map(() => null);
  }

  const order = rects.map((rect, index) => ({ index, rect }));
  const [active] = order.splice(activeIndex, 1);
  order.splice(overIndex, 0, active);

  const firstRect = rects[0];
  const transforms: Array<Transform | null> = rects.map(() => null);
  let rowLeft = firstRect.left;
  let x = rowLeft;
  let y = firstRect.top;
  // Если первая группа начинается правее общего левого края, перед ней в той
  // же строке находится закреплённая вкладка «Все». Если она уже перенеслась
  // на следующую строку, эта строка для групп считается пустой.
  const hasPinnedItemInRow =
    firstRect.left > layout.wrappedRowLeft + 0.5;
  let rowHasContent = hasPinnedItemInRow;
  let rowHeight = hasPinnedItemInRow ? firstRect.height : 0;

  for (const item of order) {
    const exceedsRow = x + item.rect.width > layout.right + 0.5;
    if (exceedsRow && rowHasContent) {
      y += rowHeight + layout.rowGap;
      rowLeft = layout.wrappedRowLeft;
      x = rowLeft;
      rowHeight = 0;
      rowHasContent = false;
    }

    transforms[item.index] = {
      x: x - item.rect.left,
      y: y - item.rect.top,
      scaleX: 1,
      scaleY: 1,
    };

    x += item.rect.width + layout.columnGap;
    rowHeight = Math.max(rowHeight, item.rect.height);
    rowHasContent = true;
  }

  return transforms;
}
