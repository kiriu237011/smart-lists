/**
 * @file ListsTopPanel.tsx
 * @description Панель с двумя вкладками (Создать / Поиск) и кнопкой сворачивания.
 *
 * Вкладка "Создать" рендерит `createListContent` (слот — произвольный ReactNode),
 * вкладка "Поиск" — поле ввода с иконкой лупы и спиннером загрузки.
 *
 * Активный таб, свёрнутость и поисковый запрос сохраняются в localStorage
 * снаружи (через колбэки `onTabCreate`, `onTabSearch`, `onSearchChange`,
 * `onSearchEscape`, `onToggleCollapse`), чтобы компонент оставался
 * презентационным и не имел побочных эффектов.
 */

"use client";

import React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslations } from "next-intl";
import CollapseChevron from "@/components/ui/CollapseChevron";

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
  /** Скрыто ли содержимое панели (вкладки остаются видны). */
  isCollapsed: boolean;
  /**
   * Анимировать ли смену состояния. Восстановление сохранённого значения после
   * гидрации проходит мгновенно: анимировать там нечего.
   */
  animateCollapse: boolean;
  /** Ref на поле ввода поиска (для автофокуса при переключении на вкладку Поиск). */
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  /** Колбэк переключения на вкладку "Создать". */
  onTabCreate: () => void;
  /** Колбэк переключения на вкладку "Поиск". */
  onTabSearch: () => void;
  /** Колбэк сворачивания и разворачивания панели. */
  onToggleCollapse: () => void;
  /** Колбэк изменения значения поля поиска. */
  onSearchChange: (value: string) => void;
  /** Колбэк нажатия Escape в поле поиска — закрывает поиск и сбрасывает запрос. */
  onSearchEscape: () => void;
  /** Содержимое вкладки "Создать" (слот). */
  createListContent: React.ReactNode;
};

/** ID содержимого панели: на него ссылается `aria-controls` кнопки сворачивания. */
const PANEL_BODY_ID = "lists-top-panel-body";

/**
 * Панель с вкладками "Создать" / "Поиск".
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
 * @param isCollapsed - Скрыто ли содержимое панели.
 * @param animateCollapse - Анимировать ли смену состояния.
 * @param searchInputRef - Ref для поля ввода поиска.
 * @param onTabCreate - Вызывается при клике на вкладку "Создать".
 * @param onTabSearch - Вызывается при клике на вкладку "Поиск".
 * @param onToggleCollapse - Вызывается при клике на кнопку сворачивания.
 * @param onSearchChange - Вызывается при изменении поля поиска.
 * @param onSearchEscape - Вызывается при нажатии Escape в поле поиска.
 * @param createListContent - ReactNode, отображаемый на вкладке "Создать".
 */
export default function ListsTopPanel({
  isSearchOpen,
  searchInput,
  isSearching,
  isPending,
  isCollapsed,
  animateCollapse,
  searchInputRef,
  onTabCreate,
  onTabSearch,
  onToggleCollapse,
  onSearchChange,
  onSearchEscape,
  createListContent,
}: ListsTopPanelProps) {
  const t = useTranslations("ListsContainer");
  const prefersReducedMotion = useReducedMotion();

  const collapseLabel = isCollapsed ? t("expandPanel") : t("collapsePanel");

  return (
    <div
      data-testid="lists-top-panel"
      data-collapsed={isCollapsed}
      className="bg-white dark:bg-zinc-900 rounded-xl shadow-sm dark:shadow-md dark:shadow-black/40 mb-4 border border-blue-100 dark:border-zinc-700"
    >
      {/* Вкладки и кнопка сворачивания. Разделительная черта нужна, только
          если ниже что-то есть: у свёрнутой панели строка вкладок — это вся
          панель, и черта висела бы над пустотой. */}
      <div
        className={`flex items-center gap-1 p-2 ${
          isCollapsed ? "" : "border-b border-gray-100 dark:border-zinc-700"
        }`}
      >
        {/* Вкладка "Создать" */}
        <button
          type="button"
          onClick={onTabCreate}
          data-testid="tab-create"
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            !isSearchOpen
              ? "bg-gray-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-gray-400 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800"
          }`}
        >
          {t("tabCreate")}
        </button>

        {/* Вкладка "Поиск" */}
        <button
          type="button"
          onClick={onTabSearch}
          data-testid="tab-search"
          className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            isSearchOpen
              ? "bg-gray-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-gray-400 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-800"
          }`}
        >
          {t("tabSearch")}
        </button>

        {/* Кнопка сворачивания стоит в правом верхнем углу панели: вкладки
            остаются на своих местах, а её позиция не зависит от их числа.
            Зона нажатия расширена невидимым `::after` — сама кнопка размером с
            соседние иконки, но пальцем 28px не поймать. */}
        <button
          type="button"
          data-testid="top-panel-toggle"
          onClick={onToggleCollapse}
          aria-label={collapseLabel}
          title={collapseLabel}
          aria-expanded={!isCollapsed}
          aria-controls={PANEL_BODY_ID}
          className="relative ml-auto inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-gray-100 hover:text-gray-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
        >
          <CollapseChevron isCollapsed={isCollapsed} />
        </button>
      </div>

      {/* Содержимое вкладки. В свёрнутом виде размонтируется, а не прячется
          стилями: и поле поиска, и черновик названия живут в состоянии
          `ListsContainer`, поэтому терять при сворачивании нечего, а скрытая
          разметка иначе осталась бы доступной поиску по странице. */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            key="body"
            id={PANEL_BODY_ID}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={
              prefersReducedMotion || !animateCollapse
                ? { duration: 0 }
                : { duration: 0.18, ease: [0.4, 0, 0.2, 1] as const }
            }
            className="overflow-hidden"
          >
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
                    data-testid="search-input"
                    value={searchInput}
                    onChange={(e) => onSearchChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        onSearchEscape();
                      }
                    }}
                    placeholder={t("searchPlaceholder")}
                    className="w-full border dark:border-zinc-700 rounded-lg pl-8 pr-8 p-3 bg-gray-50 dark:bg-zinc-800 focus:bg-white dark:focus:bg-zinc-900 focus:ring-1 ring-gray-800 dark:ring-zinc-400 outline-none transition"
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
