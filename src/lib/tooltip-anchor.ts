/**
 * @file tooltip-anchor.ts
 * @description Координаты всплывающей подсказки относительно её кнопки.
 *
 * Чистая геометрия: на вход прямоугольник кнопки, размер подсказки и размер
 * окна, на выход — координаты в системе координат окна. DOM здесь не читается,
 * поэтому правило проверяемо юнит-тестом, а не только глазами в браузере.
 *
 * Подсказка позиционируется `fixed` и рендерится порталом в `body` — по той же
 * причине, что и меню записи (`menu-anchor.ts`): строка списка на время
 * layout-анимации получает трансформ, а трансформ делает элемент содержащим
 * блоком даже для `position: fixed` потомков. Портал выносит подсказку из этих
 * предков целиком, поэтому её координаты всегда оконные.
 */

/** Зазор между кнопкой и подсказкой. */
const TOOLTIP_GAP = 6;

/**
 * Отступ от края окна.
 *
 * Больше зазора у кнопки: подсказка, прижатая к самому краю экрана, читается
 * как обрезанная, даже когда влезла целиком.
 */
const TOOLTIP_EDGE_GAP = 8;

/** Прямоугольник кнопки в координатах окна. Подмножество `DOMRect`. */
export type TooltipTriggerRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** Размер отрисованной подсказки. */
export type TooltipSize = {
  width: number;
  height: number;
};

/** Размер окна. */
export type TooltipViewport = {
  width: number;
  height: number;
};

/** Координаты подсказки в координатах окна и выбранная сторона. */
export type TooltipAnchor = {
  left: number;
  top: number;
  /** Сторона кнопки, с которой встала подсказка. Нужна для стрелки и тестов. */
  placement: "top" | "bottom";
};

/**
 * Считает координаты подсказки от прямоугольника её кнопки.
 *
 * По горизонтали подсказка центрируется по кнопке и зажимается в окно: у
 * крайней кнопки центрированная подсказка вылезала бы за экран.
 *
 * По вертикали сторона выбирается сверху, а не снизу. Кнопки в этом
 * интерфейсе почти всегда открывают что-то под собой — меню списка, меню
 * записи, блок подпунктов, — и подсказка снизу перекрывала бы результат
 * собственного нажатия за мгновение до него. Вниз она уходит только когда
 * сверху не помещается: в шапке страницы места над кнопкой нет вовсе.
 *
 * @param trigger - Прямоугольник кнопки в координатах окна.
 * @param tooltip - Размер уже отрисованной подсказки.
 * @param viewport - Размер окна.
 */
export function tooltipAnchorFor(
  trigger: TooltipTriggerRect,
  tooltip: TooltipSize,
  viewport: TooltipViewport,
): TooltipAnchor {
  const centered =
    trigger.left + (trigger.right - trigger.left) / 2 - tooltip.width / 2;
  const maxLeft = viewport.width - tooltip.width - TOOLTIP_EDGE_GAP;
  /* Прижатие к левому краю применяется последним. У подсказки шире окна
     `maxLeft` уходит левее отступа, и обратный порядок увёл бы за экран уже
     её левый край — читаемым не остался бы вовсе никакой кусок. */
  const left = Math.max(TOOLTIP_EDGE_GAP, Math.min(centered, maxLeft));

  const above = trigger.top - TOOLTIP_GAP - tooltip.height;
  const below = trigger.bottom + TOOLTIP_GAP;

  if (above >= TOOLTIP_EDGE_GAP) {
    return { left, top: above, placement: "top" };
  }
  if (below + tooltip.height <= viewport.height - TOOLTIP_EDGE_GAP) {
    return { left, top: below, placement: "bottom" };
  }
  /* Не помещается ни там, ни там — окно ниже самой подсказки. Держим её над
     кнопкой, но не выше края окна: перекрыть кнопку лучше, чем уехать из
     видимой области целиком. */
  return { left, top: TOOLTIP_EDGE_GAP, placement: "top" };
}
