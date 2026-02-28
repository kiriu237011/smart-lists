"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTransition, useState } from "react";
import { routing, type Locale } from "@/i18n/routing";

/** Метки и флаги для каждой локали */
const LOCALE_LABELS: Record<
  Locale,
  { title: string; flag: string; switchingTo: string }
> = {
  ru: {
    title: "Русский язык",
    flag: "🇷🇺",
    switchingTo: "Переключаем на русский язык",
  },
  vi: {
    title: "Tiếng Việt",
    flag: "🇻🇳",
    switchingTo: "Đang chuyển sang Tiếng Việt",
  },
};

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
            <span className="text-4xl">
              {LOCALE_LABELS[pendingLocale].flag}
            </span>
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
        className={`flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5 transition-opacity ${
          isPending ? "opacity-60 pointer-events-none" : ""
        }`}
      >
        {routing.locales.map((loc) => {
          const { title, flag } = LOCALE_LABELS[loc];
          const isActive = loc === locale;

          return (
            <button
              key={loc}
              onClick={() => handleSwitch(loc)}
              title={title}
              className={`px-2.5 py-1 rounded-full text-base transition-all duration-200 ${
                isActive
                  ? "bg-white shadow-sm"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {flag}
            </button>
          );
        })}
      </div>
    </>
  );
}
