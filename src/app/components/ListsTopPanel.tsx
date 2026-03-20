/**
 * @file ListsTopPanel.tsx
 * @description Панель с двумя вкладками (Создать / Поиск) и переключателем отображения авторов.
 *
 * Вкладка "Создать" рендерит `createListContent` (слот — произвольный ReactNode),
 * вкладка "Поиск" — поле ввода с иконкой лупы и спиннером загрузки.
 *
 * Активный таб и поисковый запрос сохраняются в localStorage снаружи
 * (через колбэки `onTabCreate`, `onTabSearch`, `onSearchChange`, `onSearchEscape`),
 * чтобы компонент оставался презентационным и не имел побочных эффектов.
 */

"use client";

import React from "react";
import { useTranslations } from "next-intl";

/** Пропсы компонента `ListsTopPanel`. */
type ListsTopPanelProps = {
  /** Открыта ли вкладка поиска. */
  isSearchOpen: boolean;
  /** Текущее значение поля ввода поиска. */
  searchInput: string;
  /** Идёт ли дебаунс-ожидание применения запроса (показываем спиннер). */
  isSearching: boolean;
  /** Идёт ли низкоприоритетный React-переход пересчёта результатов. */
  isPending: boolean;
  /** Включён ли переключатель отображения авторов. */
  showAuthors: boolean;
  /** Ref на поле ввода поиска (для автофокуса при переключении на вкладку Поиск). */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  /** Колбэк переключения на вкладку "Создать". */
  onTabCreate: () => void;
  /** Колбэк переключения на вкладку "Поиск". */
  onTabSearch: () => void;
  /** Колбэк изменения значения поля поиска. */
  onSearchChange: (value: string) => void;
  /** Колбэк нажатия Escape в поле поиска — закрывает поиск и сбрасывает запрос. */
  onSearchEscape: () => void;
  /** Колбэк переключения видимости авторов. */
  onToggleAuthors: () => void;
  /** Содержимое вкладки "Создать" (слот). */
  createListContent: React.ReactNode;
};

/**
 * Панель с вкладками "Создать" / "Поиск" и переключателем авторов.
 *
 * Вкладка "Создать" рендерит `createListContent` (слот).
 * Вкладка "Поиск" — поле ввода с иконкой лупы и анимированным спиннером.
 *
 * Логика сохранения в localStorage и управления фокусом вынесена в колбэки,
 * чтобы компонент оставался переиспользуемым и не имел побочных эффектов.
 *
 * @param isSearchOpen - Активна ли вкладка поиска.
 * @param searchInput - Текущее значение поля поиска.
 * @param isSearching - Показывать ли спиннер дебаунса.
 * @param isPending - Показывать ли спиннер React-перехода.
 * @param showAuthors - Состояние переключателя авторов.
 * @param searchInputRef - Ref для поля ввода поиска.
 * @param onTabCreate - Вызывается при клике на вкладку "Создать".
 * @param onTabSearch - Вызывается при клике на вкладку "Поиск".
 * @param onSearchChange - Вызывается при изменении поля поиска.
 * @param onSearchEscape - Вызывается при нажатии Escape в поле поиска.
 * @param onToggleAuthors - Вызывается при клике на переключатель авторов.
 * @param createListContent - ReactNode, отображаемый на вкладке "Создать".
 */
export default function ListsTopPanel({
  isSearchOpen,
  searchInput,
  isSearching,
  isPending,
  showAuthors,
  searchInputRef,
  onTabCreate,
  onTabSearch,
  onSearchChange,
  onSearchEscape,
  onToggleAuthors,
  createListContent,
}: ListsTopPanelProps) {
  const t = useTranslations("ListsContainer");

  return (
    <div className="bg-white rounded-xl shadow-sm mb-4 border border-blue-100">
      {/* Вкладки + переключатель авторов */}
      <div className="flex items-center gap-1 p-2 border-b border-gray-100">
        {/* Вкладка "Создать" */}
        <button
          type="button"
          onClick={onTabCreate}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            !isSearchOpen
              ? "bg-gray-800 text-white"
              : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          {t("tabCreate")}
        </button>

        {/* Вкладка "Поиск" */}
        <button
          type="button"
          onClick={onTabSearch}
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            isSearchOpen
              ? "bg-gray-800 text-white"
              : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          }`}
        >
          {t("tabSearch")}
        </button>

        {/* Переключатель авторов — прижат вправо */}
        <div className="flex items-center gap-2 ml-auto px-2">
          <button
            type="button"
            onClick={onToggleAuthors}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
              showAuthors ? "bg-blue-500" : "bg-gray-200"
            }`}
            role="switch"
            aria-checked={showAuthors}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${
                showAuthors ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-xs text-gray-400">{t("showAuthors")}</span>
        </div>
      </div>

      {/* Контент вкладки */}
      <div className="p-6">
        {!isSearchOpen ? (
          createListContent
        ) : (
          <div className="relative">
            {/* Иконка лупы */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  onSearchEscape();
                }
              }}
              placeholder={t("searchPlaceholder")}
              className="w-full border rounded-lg pl-8 pr-8 p-3 bg-gray-50 focus:bg-white focus:ring-1 ring-gray-800 outline-none transition"
            />
            {/* Спиннер дебаунса / React-перехода */}
            {(isSearching || isPending) && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
