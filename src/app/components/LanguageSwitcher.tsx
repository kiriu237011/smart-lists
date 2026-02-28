"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTransition } from "react";
import { routing, type Locale } from "@/i18n/routing";

/** Метки и флаги для каждой локали */
const LOCALE_LABELS: Record<Locale, { title: string; flag: string }> = {
  ru: { title: "Русский язык", flag: "🇷🇺" },
  vi: { title: "Tiếng Việt", flag: "🇻🇳" },
};

/**
 * Компонент переключения языка.
 * Стиль: таблетка с двумя вариантами, активный выделен белым фоном.
 */
export default function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleSwitch = (newLocale: Locale) => {
    if (newLocale === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  return (
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
  );
}
