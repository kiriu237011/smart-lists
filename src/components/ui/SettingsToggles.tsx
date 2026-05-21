"use client";

import { useSettings } from "@/components/providers/SettingsProvider";
import { useTranslations } from "next-intl";

/**
 * Компонент с переключателями пользовательских настроек.
 * Используется внутри HeaderSettings (и на мобильном, и на десктопе).
 */
export default function SettingsToggles() {
  const { showAuthors, toggleShowAuthors, showScrollToTop, toggleShowScrollToTop } = useSettings();
  const t = useTranslations("Settings");

  return (
    <div className="flex flex-col gap-3">
      <SettingToggle label={t("showAuthors")} checked={showAuthors} onChange={toggleShowAuthors} />
      <SettingToggle label={t("scrollToTop")} checked={showScrollToTop} onChange={toggleShowScrollToTop} />
    </div>
  );
}

function SettingToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-gray-600 dark:text-zinc-300">{label}</span>
      <button
        type="button"
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
          checked ? "bg-gray-800 dark:bg-zinc-200" : "bg-gray-200 dark:bg-zinc-700"
        }`}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white dark:bg-zinc-900 shadow transform transition-transform duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
