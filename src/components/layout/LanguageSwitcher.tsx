"use client";

import { usePathname, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { useTransition, useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { routing, type Locale } from "@/i18n/routing";

/** Метки и флаги для каждой локали */
const LOCALE_LABELS: Record<
  Locale,
  { title: string; flagCode: string; switchingTo: string }
> = {
  ru: {
    title: "Русский",
    flagCode: "ru",
    switchingTo: "Переключаем на русский",
  },
  vi: {
    title: "Tiếng Việt",
    flagCode: "vn",
    switchingTo: "Đang chuyển sang Tiếng Việt",
  },
  en: {
    title: "English",
    flagCode: "gb",
    switchingTo: "Switching to English",
  },
  ja: {
    title: "日本語",
    flagCode: "jp",
    switchingTo: "日本語に切り替え中",
  },
};

/** Компонент флага через flagcdn.com — корректно отображается на всех платформах */
function Flag({ code, size = 20 }: { code: string; size?: number }) {
  return (
    // Внешний SVG с CDN: next/image не даёт здесь выгоды (SVG не оптимизируется),
    // а потребовал бы разрешить домен в next.config
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/${code}.svg`}
      alt={code.toUpperCase()}
      className="rounded-sm object-contain flex-shrink-0"
      style={{ width: size, height: Math.round(size * 0.75), minWidth: size }}
    />
  );
}

/**
 * Компонент переключения языка.
 *
 * В свёрнутом виде — компактная «таблетка» с флагом и кодом активного языка.
 * По клику раскрывается выпадающий список всех локалей (закрывается по клику
 * вне списка или по Escape). При переключении показывает полноэкранный
 * оверлей с флагом и спиннером.
 */
export default function LanguageSwitcher() {
  const { locale } = useParams<{ locale: Locale }>();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Закрытие списка по клику/тапу вне компонента и по Escape
  useEffect(() => {
    if (!isOpen) return;

    const handlePointer = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  const handleSwitch = (newLocale: Locale) => {
    setIsOpen(false);
    if (newLocale === locale) return;
    setPendingLocale(newLocale);
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  const active = LOCALE_LABELS[locale];

  return (
    <>
      {/* Полноэкранный оверлей при переключении */}
      {isPending && pendingLocale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 dark:bg-black/40 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 bg-white/90 dark:bg-zinc-900/90 rounded-2xl px-8 py-6 shadow-lg">
            <Flag code={LOCALE_LABELS[pendingLocale].flagCode} size={40} />
            <p className="text-sm text-gray-500 dark:text-zinc-400 font-medium">
              {LOCALE_LABELS[pendingLocale].switchingTo}
            </p>
            <svg
              className="w-5 h-5 animate-spin text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
          </div>
        </div>
      )}

      <div ref={containerRef} className="relative">
        {/* Свёрнутая таблетка: только активный язык */}
        <button
          type="button"
          data-testid="locale-trigger"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          title={active.title}
          className={`flex items-center gap-2 bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-full pl-3 pr-2.5 py-2 text-sm font-semibold text-gray-600 dark:text-zinc-300 hover:bg-gray-200/70 dark:hover:bg-zinc-700/70 transition-all duration-200 cursor-pointer ${
            isPending ? "opacity-60 pointer-events-none" : ""
          }`}
        >
          <Flag code={active.flagCode} size={18} />
          <span>{locale.toUpperCase()}</span>
          {/* Шеврон: поворачивается при раскрытии */}
          <svg
            className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
              isOpen ? "rotate-180" : ""
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* Выпадающий список всех языков */}
        <AnimatePresence>
          {isOpen && (
            <motion.ul
              role="listbox"
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-44 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-700 rounded-2xl shadow-xl dark:shadow-2xl dark:shadow-black/50 z-50 p-1.5"
            >
              {routing.locales.map((loc) => {
                const { title, flagCode } = LOCALE_LABELS[loc];
                const isActive = loc === locale;

                return (
                  <li key={loc}>
                    <button
                      type="button"
                      role="option"
                      data-testid="locale-option"
                      data-locale={loc}
                      aria-selected={isActive}
                      onClick={() => handleSwitch(loc)}
                      className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                        isActive
                          ? "bg-gray-100 dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400"
                          : "text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <Flag code={flagCode} size={18} />
                      <span className="flex-1 text-left">{title}</span>
                      {/* Галочка у активного языка */}
                      {isActive && (
                        <svg
                          className="w-4 h-4 flex-shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
