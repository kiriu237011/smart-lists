"use client";

import { useEffect, useRef, useState } from "react";

type AvatarButtonProps = {
  /** Первая буква имени / email для отображения в кружке */
  initial: string;
  /** Email, который показывается во всплывающем окошке */
  email: string;
};

/**
 * Аватар-кнопка: на мобильных устройствах при клике показывает
 * всплывающее окошечко с email пользователя.
 * На больших экранах (sm+) email уже виден в заголовке, поэтому
 * popup отображается только на экранах < 480 px.
 */
export default function AvatarButton({ initial, email }: AvatarButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Закрыть popup при клике вне компонента
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Кружок с буквой — кликабелен только на мобильных (< 480px) */}
      <button
        type="button"
        aria-label={`Показать email: ${email}`}
        onClick={() => setOpen((prev) => !prev)}
        className="[@media(min-width:480px)]:cursor-default w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-semibold text-xs sm:text-base flex items-center justify-center uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
      >
        {initial}
      </button>

      {/* Всплывающий тултип — только на экранах < 480px */}
      {open && (
        <div className="[@media(min-width:480px)]:hidden absolute left-0 top-full mt-2 z-50 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 shadow-lg px-3 py-2 text-xs text-gray-700 dark:text-zinc-300 whitespace-nowrap">
          {email}
          {/* Маленький треугольничек сверху */}
          <span className="absolute -top-1.5 left-4 w-3 h-3 rotate-45 bg-white dark:bg-zinc-800 border-l border-t border-gray-200 dark:border-zinc-700" />
        </div>
      )}
    </div>
  );
}
