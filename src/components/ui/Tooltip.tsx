/**
 * @file Tooltip.tsx
 * @description Всплывающая подсказка иконочной кнопки.
 *
 * Заменяет нативный `title`. Причин три, и каждой хватило бы по отдельности:
 * на тач-устройствах `title` не показывается вовсе, его задержку и вид задаёт
 * браузер, а с клавиатуры он не появляется — то есть подсказка не доходила
 * ровно до тех, кому нужнее всего.
 *
 * Компонент не рисует обёртку вокруг кнопки: она попала бы в flex-раскладку
 * шапок и строк и сдвинула бы соседей. Вместо этого обработчики домешиваются
 * к самой кнопке через `cloneElement`, а подсказка уходит порталом в `body`.
 *
 * Подсказка помечена `aria-hidden`: её текст дублирует `aria-label` кнопки, и
 * без этого скринридер прочитал бы одно и то же дважды. Отсюда же правило
 * `aria-label` по умолчанию — см. проп `label`.
 *
 * Одно место `title` за собой оставляет: выключенная кнопка не получает
 * pointer-событий, поэтому подсказка о причине блокировки должна быть
 * нативной. Такие вызовы помечены комментарием на месте.
 */

"use client";

import {
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import { tooltipAnchorFor, type TooltipAnchor } from "@/lib/tooltip-anchor";

/**
 * Задержка перед показом при наведении.
 *
 * Без неё подсказки вспыхивают под курсором, идущим через панель к своей цели.
 * 400 мс — примерно столько же ждёт нативный `title`, поэтому ощущение
 * остаётся привычным.
 */
const HOVER_DELAY_MS = 400;

/** Запрошенный показ: чью геометрию снимать и ждать ли задержку. */
type PendingShow = {
  trigger: HTMLElement;
  /** Показ без задержки — так приходит клавиатурный фокус. */
  instant: boolean;
};

/**
 * Пропсы кнопки, которые компонент читает и переопределяет.
 *
 * Исходные обработчики не теряются: подмешанные вызывают их первыми.
 */
type TooltipTriggerProps = {
  "aria-label"?: string;
  onPointerEnter?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onFocus?: (event: ReactFocusEvent<HTMLElement>) => void;
  onBlur?: (event: ReactFocusEvent<HTMLElement>) => void;
};

/** Пропсы компонента `Tooltip`. */
type TooltipProps = {
  /**
   * Текст подсказки.
   *
   * Он же становится `aria-label` кнопки, если своего у неё нет. Так у
   * иконочной кнопки остаётся один источник подписи и ей нечем разойтись с
   * подсказкой. Свой `aria-label` нужен там, где озвучка должна быть подробнее
   * видимого текста: «Действия со списком X» для скринридера против «Действия»
   * в подсказке.
   */
  label: string;
  /** Кнопка, к которой относится подсказка. Ровно один элемент. */
  children: ReactElement<TooltipTriggerProps>;
  /**
   * Не показывать подсказку.
   *
   * Для кнопок, у которых подпись нужна не всегда: пояснение к исчерпанной
   * квоте бессмысленно, пока квота свободна.
   */
  disabled?: boolean;
  /**
   * Служит ли подсказка подписью кнопки.
   *
   * Выключается у кнопок с видимым текстом: там подпись уже есть, и
   * `aria-label` не дополнил бы её, а заменил — скринридер читает атрибут
   * вместо содержимого. Подсказка у таких кнопок дополняет, а не называет:
   * «Ctrl/⌘ + Enter — сохранить» у кнопки «Сохранить».
   */
  labelsTrigger?: boolean;
};

export default function Tooltip({
  label,
  children,
  disabled = false,
  labelsTrigger = true,
}: TooltipProps) {
  /* Запрошенный показ: кнопка и признак «без задержки». Отдельное состояние,
     а не таймер в ref, — так его отменяет сам React. Уборка эффекта гасит
     таймер и при уводе указателя, и при размонтировании кнопки, поэтому
     отложенный показ не может пережить того, о чём рассказывает. */
  const [pending, setPending] = useState<PendingShow | null>(null);
  /* Прямоугольник кнопки снимается в момент показа и до скрытия не
     пересчитывается: подсказка живёт, пока указатель стоит на кнопке, а
     кнопка под ним никуда не едет. Прокрутка и изменение размера окна её
     просто убирают — дешевле и честнее, чем гнаться за ней каждый кадр. */
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const [anchor, setAnchor] = useState<TooltipAnchor | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const hide = useCallback(() => {
    setPending(null);
    setTriggerRect(null);
    setAnchor(null);
  }, []);

  useEffect(() => {
    if (pending === null) return;

    const capture = () => {
      /* Кнопка могла исчезнуть за время задержки: подсказка о ней показала бы
         текст у нулевых координат, то есть в углу экрана. */
      if (!pending.trigger.isConnected) return;
      setAnchor(null);
      setTriggerRect(pending.trigger.getBoundingClientRect());
    };

    if (pending.instant) {
      capture();
      return;
    }

    const timer = window.setTimeout(capture, HOVER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  /* Координаты известны только после отрисовки: ширина подсказки зависит от
     длины текста, а от неё — и сторона, и зажатие в окно. Layout-эффект
     считает их до того, как браузер нарисует кадр, поэтому подсказка не
     успевает мелькнуть на неверном месте. До этого момента её держит
     прозрачной `anchor === null`. */
  useLayoutEffect(() => {
    if (triggerRect === null) return;
    const node = tooltipRef.current;
    if (node === null) return;

    setAnchor(
      tooltipAnchorFor(
        triggerRect,
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [triggerRect]);

  useEffect(() => {
    if (triggerRect === null) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    /* Прокрутка слушается в фазе перехвата: страница прокручивается не только
       окном, но и внутренними контейнерами, а их события до `window` не
       всплывают. */
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [triggerRect, hide]);

  const triggerProps = children.props;

  const merged: TooltipTriggerProps = {
    ...(labelsTrigger
      ? { "aria-label": triggerProps["aria-label"] ?? label }
      : {}),
    onPointerEnter: (event) => {
      triggerProps.onPointerEnter?.(event);
      if (disabled) return;
      /* Наведения на тач-устройстве не существует: `pointerenter` там
         приходит вместе с тапом, и подсказка всплывала бы поверх результата
         собственного нажатия. */
      if (event.pointerType === "touch") return;
      setPending({ trigger: event.currentTarget, instant: false });
    },
    onPointerLeave: (event) => {
      triggerProps.onPointerLeave?.(event);
      hide();
    },
    onPointerDown: (event) => {
      triggerProps.onPointerDown?.(event);
      hide();
    },
    onFocus: (event) => {
      triggerProps.onFocus?.(event);
      if (disabled) return;
      /* Только клавиатурный фокус. После клика мышью кнопка тоже остаётся
         сфокусированной, и подсказка висела бы над уже открытым меню, пока
         фокус не уйдёт. `:focus-visible` — ровно то различие, которое здесь
         нужно, и его уже проводит сам браузер. */
      if (!event.currentTarget.matches(":focus-visible")) return;
      // Клавиатурный пользователь дошёл до кнопки намеренно — ждать нечего.
      setPending({ trigger: event.currentTarget, instant: true });
    },
    onBlur: (event) => {
      triggerProps.onBlur?.(event);
      hide();
    },
  };

  return (
    <>
      {cloneElement(children, merged)}
      {triggerRect !== null && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              aria-hidden
              data-testid="tooltip"
              data-tooltip-placement={anchor?.placement}
              style={{ left: anchor?.left ?? 0, top: anchor?.top ?? 0 }}
              /* `pointer-events-none` обязателен: подсказка встаёт вплотную к
                 кнопке, и без него собственное появление могло бы увести
                 указатель с кнопки и тут же её убрать. */
              /* `z-[60]`, а не `z-60`: в шкале Tailwind ступени 60 нет, и
                 класс просто не сгенерировался бы. Значение выше `z-50`
                 модалок — подсказка нужна и у кнопок внутри них, а без своего
                 z-index она осталась бы под их контекстом наложения. */
              className={`pointer-events-none fixed z-[60] max-w-64 rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-lg transition-opacity duration-100 motion-reduce:transition-none dark:bg-zinc-100 dark:text-zinc-900 ${
                anchor === null ? "opacity-0" : "opacity-100"
              }`}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
