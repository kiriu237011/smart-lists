/**
 * @file menu-anchor.ts
 * @description Координаты выпадающего меню, закреплённого за своей кнопкой.
 *
 * Клиентский модуль: считает по геометрии окна.
 *
 * Меню списка и меню записи позиционируются `fixed`, а не `absolute`, по двум
 * причинам сразу.
 *
 * Первая — раскладка. Абсолютный потомок влиял на неё в прежней `columns`-вёрстке
 * карточек, а меню записи вдобавок оказывалось заперто внутри своей строки:
 * `Reorder.Item` на время layout-анимации получает inline-трансформ, а
 * трансформ создаёт у элемента собственный контекст наложения. Меню с любым
 * `z-index` внутри такого предка перестаёт всплывать над следующими строками —
 * их названия и кнопки рисуются поверх него. `fixed`-меню лежит вне этих
 * контекстов и от трансформов предков не зависит вовсе.
 *
 * Вторая — короткий экран. Меню умеет раскрываться вверх, не завися от
 * переполнения карточки.
 */

/** Зазор между кнопкой и её меню. */
const MENU_GAP = 4;

/**
 * Отступ от края окна, ниже которого меню считается не поместившимся.
 * Больше зазора у кнопки: меню, прижатое к самому краю экрана, выглядит
 * обрезанным даже когда влезло целиком.
 */
const MENU_EDGE_GAP = 12;

/**
 * Координаты меню в координатах окна.
 *
 * Задаётся либо `top`, либо `bottom` — вторая координата остаётся `undefined`,
 * и React её не выставляет.
 */
export type MenuAnchor = {
  right: number;
  top?: number;
  bottom?: number;
};

/**
 * Считает координаты меню от его кнопки, выравнивая по её правому краю.
 *
 * Если снизу не хватает места, меню раскрывается вверх. Вверх — только когда
 * оно там действительно помещается: у карточки внизу короткого экрана может не
 * хватать места ни снизу, ни сверху, и переворот сделал бы хуже, уведя меню за
 * верхнюю границу окна.
 *
 * @param button - Кнопка, открывающая меню.
 * @param menuHeight - Высота меню; 0, пока оно не отрисовано. При первом
 *                     открытии высоты ещё нет и меню раскрывается вниз —
 *                     поправляет это layout-эффект вызывающего, до того как
 *                     браузер нарисует кадр.
 */
export function menuAnchorFor(
  button: HTMLElement,
  menuHeight: number,
): MenuAnchor {
  const rect = button.getBoundingClientRect();
  const right = window.innerWidth - rect.right;
  const spaceBelow = window.innerHeight - rect.bottom - MENU_EDGE_GAP;
  const spaceAbove = rect.top - MENU_EDGE_GAP;

  if (menuHeight > spaceBelow && menuHeight <= spaceAbove) {
    return { right, bottom: window.innerHeight - rect.top + MENU_GAP };
  }
  return { right, top: rect.bottom + MENU_GAP };
}

/** Совпадают ли координаты. Возврат прежнего объекта отменяет лишний ререндер. */
export function sameMenuAnchor(
  current: MenuAnchor | null,
  next: MenuAnchor,
): boolean {
  return (
    current !== null &&
    current.right === next.right &&
    current.top === next.top &&
    current.bottom === next.bottom
  );
}
