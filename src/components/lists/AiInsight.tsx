/**
 * @file AiInsight.tsx
 * @description AI-инсайт для карточки списка.
 *
 * Экспортирует два компонента:
 *   - `AiInsightButton` — кнопка-триггер (управляется снаружи через `isOpen`/`onToggle`).
 *   - `AiInsight`       — панель с полем вопроса и результатом анализа.
 */

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { getListInsight } from "@/app/actions/insights";

/** Пропсы кнопки-триггера. */
type AiInsightButtonProps = {
  isOpen: boolean;
  onToggle: () => void;
};

/** Кнопка-пилюля для раскрытия панели AI-инсайта. */
export function AiInsightButton({ isOpen, onToggle }: AiInsightButtonProps) {
  const t = useTranslations("AiInsight");

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all duration-200 ${
        isOpen
          ? "bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-700/50 dark:text-indigo-400"
          : "bg-white border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-indigo-700/50 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/30"
      }`}
    >
      {/* Иконка искры */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="w-3.5 h-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
      </svg>
      {t("button")}
      {/* Шеврон */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

type AiInsightProps = {
  /** ID списка — используется для получения данных из БД на сервере. */
  listId: string;
};

/**
 * Панель AI-инсайта: поле вопроса, кнопка анализа, результат.
 * Рендерится только когда активна (управляется снаружи).
 */
export default function AiInsight({ listId }: AiInsightProps) {
  const t = useTranslations("AiInsight");

  const [userMessage, setUserMessage] = useState("");
  const [insight, setInsight] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setInsight(null);
    setError(null);
    setIsLoading(true);

    const result = await getListInsight(listId, userMessage.trim() || undefined);

    setIsLoading(false);

    if (result.error) {
      setError(t("error"));
    } else if (result.insight) {
      setInsight(result.insight);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Поле вопроса */}
      <textarea
        value={userMessage}
        onChange={(e) => setUserMessage(e.target.value)}
        placeholder={t("placeholder")}
        rows={2}
        className="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 bg-gray-50 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 placeholder:text-gray-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 ring-gray-400 dark:ring-zinc-500 resize-none transition"
      />

      {/* Кнопка запроса — полная ширина */}
      <button
        type="button"
        onClick={() => void handleAnalyze()}
        disabled={isLoading}
        className="w-full text-xs px-3 py-1.5 rounded-lg bg-gray-800 dark:bg-zinc-200 text-white dark:text-zinc-900 hover:bg-gray-700 dark:hover:bg-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 font-medium"
      >
        {isLoading ? (
          <>
            {/* Спиннер */}
            <svg
              className="animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {t("analyzing")}
          </>
        ) : (
          t("analyze")
        )}
      </button>

      {/* Результат — инсайт */}
      {insight && (
        <p className="text-xs text-gray-600 dark:text-zinc-300 leading-relaxed bg-gray-50 dark:bg-zinc-800 rounded-lg px-3 py-2.5 border border-gray-100 dark:border-zinc-700">
          {insight}
        </p>
      )}

      {/* Ошибка */}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
