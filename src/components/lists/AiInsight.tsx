/**
 * @file AiInsight.tsx
 * @description Клиентский компонент AI-инсайта для карточки списка.
 *
 * Пользователь нажимает кнопку — открывается панель с необязательным полем вопроса.
 * При отправке вызывает Server Action `getListInsight`, показывает спиннер,
 * затем отображает текст инсайта от Claude.
 */

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { getListInsight } from "@/app/actions/insights";

type AiInsightProps = {
  /** ID списка — используется для получения данных из БД на сервере. */
  listId: string;
};

/**
 * Панель AI-инсайта внутри карточки списка.
 *
 * @param title - Название списка.
 * @param items - Массив имён записей.
 */
export default function AiInsight({ listId }: AiInsightProps) {
  const t = useTranslations("AiInsight");

  const [isOpen, setIsOpen] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [insight, setInsight] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    // Сбрасываем предыдущий результат
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
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-700">
      {/* Кнопка-триггер */}
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors"
        >
          {/* Иконка искры */}
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
          </svg>
          {t("button")}
        </button>
      ) : (
        <div className="space-y-2">
          {/* Заголовок панели с кнопкой закрытия */}
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400 font-medium">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
              </svg>
              {t("button")}
            </span>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setInsight(null);
                setError(null);
                setUserMessage("");
              }}
              className="text-xs text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-400 transition-colors"
              aria-label="Закрыть"
            >
              ✗
            </button>
          </div>

          {/* Поле вопроса */}
          <textarea
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder={t("placeholder")}
            rows={2}
            className="w-full text-xs border border-gray-200 dark:border-zinc-700 rounded-lg px-2.5 py-2 bg-gray-50 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 placeholder:text-gray-300 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 ring-gray-400 dark:ring-zinc-500 resize-none transition"
          />

          {/* Кнопка запроса */}
          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={isLoading}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 dark:bg-zinc-200 text-white dark:text-zinc-900 hover:bg-gray-700 dark:hover:bg-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {isLoading ? (
              <>
                {/* Спиннер */}
                <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
            <p className="text-xs text-red-500 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
