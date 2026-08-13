/**
 * @file item-drop.ts
 * @description Геометрия переноса записи в другой список перетаскиванием.
 *
 * Записи двигает framer-motion `Reorder`, а она односоставная: строка живёт
 * внутри своей группы и о существовании соседней карточки не знает. Поэтому
 * цель жеста определяет не библиотека, а координаты указателя — на старте
 * снимаются прямоугольники видимых карточек, дальше каждый кадр проверяет,
 * какая из них накрывает точку.
 *
 * Почему снимок геометрии, а не `elementFromPoint`: строку, вынесенную за
 * пределы своей карточки, framer рисует поверх соседей, и под курсором верхним
 * элементом оказывалась бы она сама — цель под ней не находилась бы вовсе.
 * Геометрия от порядка отрисовки не зависит и не заставляет браузер
 * пересчитывать раскладку на каждом кадре.
 *
 * Снимок остаётся верным до конца жеста: перетаскиваемая строка остаётся в
 * потоке, число строк не меняется, поэтому высоты карточек постоянны.
 * Единственное, что может сдвинуть карточки, — прокрутка страницы, и она
 * учитывается поправкой на смещение.
 */

/** Атрибут, которым карточка списка объявляет себя целью переноса записи. */
export const DROP_TARGET_ATTR = "data-item-drop-list";

/** Атрибут подсветки карточки, на которую сейчас нацелен бросок. */
export const DROP_ACTIVE_ATTR = "data-item-drop-active";

/** Точка в координатах окна. */
export type Point = { x: number; y: number };

/** Прямоугольник карточки в координатах окна на момент снимка. */
export type DropTargetBox = {
  listId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** Снимок целей вместе с прокруткой, к которой привязаны их координаты. */
export type DropTargets = {
  boxes: DropTargetBox[];
  scroll: Point;
};

/**
 * Минимум, который нужен от события жеста. framer отдаёт `MouseEvent`,
 * `TouchEvent` или `PointerEvent`, и общего у них ровно столько.
 */
type PointerLike = {
  clientX?: number;
  clientY?: number;
  changedTouches?: ArrayLike<{ clientX: number; clientY: number }>;
};

/**
 * Координаты указателя из события жеста.
 *
 * `changedTouches` проверяется первым: у `touchend` список активных касаний уже
 * пуст, а точка отпускания лежит именно там — без неё жест пальцем терял бы
 * цель ровно в момент броска.
 */
export function pointerPoint(event: PointerLike): Point | null {
  const touch = event.changedTouches?.[0];
  if (touch) return { x: touch.clientX, y: touch.clientY };
  if (typeof event.clientX === "number" && typeof event.clientY === "number") {
    return { x: event.clientX, y: event.clientY };
  }
  return null;
}

/**
 * Карточка под указателем — включая исходную.
 *
 * Исходная не отбрасывается намеренно: «указатель ушёл с своей карточки» —
 * отдельное состояние жеста, по нему показывается превью. Кого считать целью
 * переноса, решает вызывающий код.
 *
 * @param scroll - Текущая прокрутка окна. Точка приводится к системе координат
 *                 снимка, иначе прокрутка посреди жеста сдвигала бы все цели.
 */
export function listIdAtPoint(
  targets: DropTargets,
  point: Point,
  scroll: Point,
): string | null {
  const x = point.x + scroll.x - targets.scroll.x;
  const y = point.y + scroll.y - targets.scroll.y;

  for (const box of targets.boxes) {
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) {
      return box.listId;
    }
  }
  return null;
}

/** Текущая прокрутка окна. */
export function windowScroll(): Point {
  return { x: window.scrollX, y: window.scrollY };
}

/** Снимок геометрии видимых карточек. */
export function captureDropTargets(): DropTargets {
  const boxes: DropTargetBox[] = [];

  document.querySelectorAll(`[${DROP_TARGET_ATTR}]`).forEach((element) => {
    const listId = element.getAttribute(DROP_TARGET_ATTR);
    if (!listId) return;

    const rect = element.getBoundingClientRect();
    // Нулевой прямоугольник остаётся у карточки, доигрывающей исчезновение при
    // смене колонки: попадать в неё броском нечем и незачем.
    if (rect.width === 0 || rect.height === 0) return;

    boxes.push({
      listId,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
  });

  return { boxes, scroll: windowScroll() };
}

/**
 * Подсвечивает карточку-получателя.
 *
 * Пишет прямо в DOM, потому что цель — чужая мемоизированная карточка: путь до
 * неё через состояние шёл бы по `ListsContainer` и перерисовывал бы все
 * карточки на каждое пересечение границы. Тот же приём, что у тела карточки
 * при сворачивании, и по той же причине.
 *
 * Прежняя подсветка снимается со всех карточек разом, поэтому повторный вызов
 * чинит любое расхождение — в том числе оставшееся от прерванного жеста.
 */
export function setDropHighlight(listId: string | null): void {
  document
    .querySelectorAll(`[${DROP_ACTIVE_ATTR}]`)
    .forEach((element) => element.removeAttribute(DROP_ACTIVE_ATTR));

  if (!listId) return;

  document
    .querySelector(`[${DROP_TARGET_ATTR}="${CSS.escape(listId)}"]`)
    ?.setAttribute(DROP_ACTIVE_ATTR, "true");
}
