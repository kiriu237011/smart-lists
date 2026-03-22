"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTransition, useState } from "react";
import { routing, type Locale } from "@/i18n/routing";

/** Метки и флаги для каждой локали */
const LOCALE_LABELS: Record<
  Locale,
  { title: string; flagCode: string; switchingTo: string }
> = {
  ru: {
    title: "Русский язык",
    flagCode: "ru",
    switchingTo: "Переключаем на русский",
  },
  vi: {
    title: "Tiếng Việt",
    flagCode: "vn",
    switchingTo: "Đang chuyển sang Tiếng Việt",
  },
};

/** Компонент флага через flagcdn.com — корректно отображается на всех платформах */
function Flag({ code, size = 20 }: { code: string; size?: number }) {
  return (
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
 * При переключении показывает полноэкранный оверлей с флагом и спиннером.
 */
export default function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);

  const handleSwitch = (newLocale: Locale) => {
    if (newLocale === locale) return;
    setPendingLocale(newLocale);
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  return (
    <>
      {/* Полноэкранный оверлей при переключении */}
      {isPending && pendingLocale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/10 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3 bg-white/90 rounded-2xl px-8 py-6 shadow-lg">
            <Flag code={LOCALE_LABELS[pendingLocale].flagCode} size={40} />
            <p className="text-sm text-gray-500 font-medium">
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

      {/* Сама таблетка */}
      <div
        className={`flex items-center gap-1 bg-gray-100 border border-gray-200 rounded-full px-1.5 py-0.5 transition-opacity ${
          isPending ? "opacity-60 pointer-events-none" : ""
        }`}
      >
        {/* Иконка глобуса — только на sm+ */}
        <svg
          className="hidden sm:block w-3.5 h-3.5 text-gray-400 flex-shrink-0 ml-0.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>

        <div className="flex items-center gap-0.5">
          {routing.locales.map((loc) => {
            const { title, flagCode } = LOCALE_LABELS[loc];
            const isActive = loc === locale;

            return (
              <button
                key={loc}
                onClick={() => handleSwitch(loc)}
                title={title}
                className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full transition-all duration-200 text-xs font-semibold ${
                  isActive
                    ? "bg-white shadow-sm text-indigo-600"
                    : "text-gray-400 hover:text-gray-500 hover:bg-white/60"
                }`}
              >
                <Flag code={flagCode} size={14} />
                <span className="hidden sm:inline">{loc.toUpperCase()}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
