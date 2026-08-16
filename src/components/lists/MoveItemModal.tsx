/**
 * @file MoveItemModal.tsx
 * @description Выбор списка-получателя при переносе или копировании записи.
 *
 * Client Component (`"use client"`).
 *
 * Выбор идёт в два шага: сначала группа, потом список внутри неё. Одним
 * экраном это не решается — при десятке групп прокручиваемый список секций
 * не даёт увидеть, что вообще есть в пространстве. Экран групп показывает
 * весь набор целиком и со счётчиками, а экран списков остаётся коротким.
 *
 * Клик по строке списка выполняет действие сразу — как в меню групп у
 * `ListCard`. Отдельной кнопки подтверждения нет: выбор списка и есть
 * подтверждение, а режим задан чекбоксом, который живёт на обоих шагах.
 *
 * Два послабления, чтобы шаги не мешали частым случаям:
 *   - поиск на первом шаге ищет сразу по спискам и ведёт к цели минуя группы;
 *   - когда секция всего одна (например, групп нет вовсе), первый шаг
 *     пропускается: выбирать там не из чего.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  useListsDirectory,
  type ListDirectoryEntry,
} from "@/components/providers/ListsDirectoryProvider";
import Tooltip from "@/components/ui/Tooltip";

/** ID секции списков, не входящих ни в одну группу. */
const NO_GROUP = "__none__";

/** Начиная с какого числа списков появляется поиск. Ниже он только мешает. */
const SEARCH_THRESHOLD = 8;

/** Пропсы компонента `MoveItemModal`. */
type MoveItemModalProps = {
  /** ID списка, в котором запись находится сейчас. Выбрать его нельзя. */
  sourceListId: string;
  /** Выбор цели. Модал закрывает вызывающий код. */
  onSelect: (targetListId: string, mode: "move" | "copy") => void;
  /** Закрытие без выбора (Escape, клик по фону, крестик). */
  onClose: () => void;
};

/** Иконка «список видит кто-то ещё». */
function SharedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export default function MoveItemModal({
  sourceListId,
  onSelect,
  onClose,
}: MoveItemModalProps) {
  const t = useTranslations("SmartList.moveToList");
  const { lists, groups } = useListsDirectory();

  const searchInputRef = useRef<HTMLInputElement>(null);

  /** Выбранная группа. null — пользователь на первом шаге. */
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [copyMode, setCopyMode] = useState(false);

  /** Поиск нужен, только когда списков много: иначе всё видно и так. */
  const showSearch = lists.length > SEARCH_THRESHOLD;

  // Escape закрывает модал целиком, как и остальные диалоги проекта. Шаг назад
  // делает стрелка в заголовке: Escape в диалоге привычнее как «уйти совсем».
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  /** Группы списка-источника — помечаются на экране выбора группы. */
  const sourceGroupIds = useMemo(
    () => lists.find((list) => list.id === sourceListId)?.groupIds ?? [],
    [lists, sourceListId],
  );

  /**
   * Секции: группа → её списки. Пустые группы отброшены — заходить в них
   * незачем. Порядок групп пользователя сохраняется, «Без группы» идёт
   * последней: экран обзора должен выглядеть одинаково при каждом открытии.
   */
  const sections = useMemo(() => {
    const result = groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        lists: lists.filter((list) => list.groupIds.includes(group.id)),
      }))
      .filter((section) => section.lists.length > 0);

    const ungrouped = lists.filter((list) => list.groupIds.length === 0);
    if (ungrouped.length > 0) {
      result.push({ id: NO_GROUP, name: t("noGroup"), lists: ungrouped });
    }
    return result;
  }, [lists, groups, t]);

  /** Списки, совпавшие с поиском. Пустой запрос — поиск не идёт. */
  const searchResults = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return null;
    return lists.filter((list) => list.title.toLocaleLowerCase().includes(q));
  }, [lists, query]);

  /** Имена групп по ID — подпись под результатом поиска, где группа не видна. */
  const groupNames = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  );

  /**
   * Секция к показу на втором шаге. Единственная секция открывается сразу:
   * экран выбора из одного варианта — лишний клик.
   */
  const openSection =
    sections.length === 1
      ? sections[0]
      : (sections.find((section) => section.id === selectedGroupId) ?? null);

  /** Других списков нет вовсе — выбирать не из чего. */
  const hasOtherLists = lists.some((list) => list.id !== sourceListId);

  // Фокус в поиск при открытии первого шага: цель ищется набором, без Tab.
  useEffect(() => {
    if (!openSection) searchInputRef.current?.focus();
  }, [openSection]);

  /** Строка списка. `caption` показывается только в результатах поиска. */
  const renderListRow = (list: ListDirectoryEntry, caption?: string) => {
    const isSource = list.id === sourceListId;
    return (
      <li key={list.id}>
        <button
          type="button"
          data-testid="move-item-target"
          data-list-id={list.id}
          disabled={isSource}
          onClick={() => onSelect(list.id, copyMode ? "copy" : "move")}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
            isSource
              ? "cursor-not-allowed text-gray-400 dark:text-zinc-600"
              : "text-gray-800 hover:bg-gray-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
          }`}
        >
          <span className="min-w-0 truncate">
            {list.title}
            {caption && (
              <span className="ml-2 text-xs text-gray-400 dark:text-zinc-500">
                {caption}
              </span>
            )}
          </span>
          {/* Перенос в общий список открывает заметку записи остальным
              участникам — помечаем. */}
          {list.isShared && (
            <span
              className="shrink-0 text-gray-400 dark:text-zinc-500"
              title={t("shared")}
              aria-label={t("shared")}
            >
              <SharedIcon />
            </span>
          )}
          {isSource && (
            <span className="ml-auto shrink-0 text-xs">{t("current")}</span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        data-testid="move-item-modal"
        className="flex max-h-[70vh] w-full max-w-sm flex-col rounded-xl bg-white p-4 shadow-lg dark:border dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-2xl dark:shadow-black/70"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-item-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-1.5">
          {/* Стрелка назад появляется только там, где есть куда возвращаться:
              при единственной секции первый шаг пропущен. */}
          {openSection && sections.length > 1 && (
            <Tooltip label={t("back")}>
              <button
                type="button"
                data-testid="move-item-back"
                onClick={() => setSelectedGroupId(null)}
                className="-ml-1 shrink-0 rounded p-1 text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-zinc-200"
              >
                ‹
              </button>
            </Tooltip>
          )}
          <h3 id="move-item-title" className="min-w-0 truncate text-sm font-semibold">
            {openSection ? openSection.name : t("groupsTitle")}
          </h3>
          <Tooltip label={t("close")}>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 ml-auto shrink-0 rounded p-1 text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-zinc-200"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        {!hasOtherLists ? (
          <p className="py-5 text-center text-sm text-gray-400 dark:text-zinc-500">
            {t("empty")}
          </p>
        ) : (
          <>
            {/* Поиск живёт на первом шаге: внутри одной группы списков мало. */}
            {showSearch && !openSection && (
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
                className="mb-2 w-full rounded-md bg-gray-100 px-3 py-1.5 text-sm outline-none transition-colors focus:bg-gray-50 dark:bg-zinc-900 dark:focus:bg-zinc-900/60"
              />
            )}

            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              {openSection ? (
                <ul>{openSection.lists.map((list) => renderListRow(list))}</ul>
              ) : searchResults ? (
                // Поиск ведёт прямо к списку: группа при этом не выбирается,
                // поэтому её название идёт подписью к строке.
                searchResults.length === 0 ? (
                  <p className="py-5 text-center text-sm text-gray-400 dark:text-zinc-500">
                    {t("noResults")}
                  </p>
                ) : (
                  <ul>
                    {searchResults.map((list) =>
                      renderListRow(
                        list,
                        list.groupIds
                          .map((id) => groupNames.get(id))
                          .filter(Boolean)
                          .join(", ") || t("noGroup"),
                      ),
                    )}
                  </ul>
                )
              ) : (
                <ul>
                  {sections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        data-testid="move-item-group"
                        data-group-id={section.id}
                        onClick={() => setSelectedGroupId(section.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-gray-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                      >
                        <span className="min-w-0 truncate">{section.name}</span>
                        {/* Группа списка-источника: видно, откуда едет запись. */}
                        {(section.id === NO_GROUP
                          ? sourceGroupIds.length === 0
                          : sourceGroupIds.includes(section.id)) && (
                          <span
                            className="shrink-0 text-gray-300 dark:text-zinc-600"
                            title={t("currentGroup")}
                            aria-label={t("currentGroup")}
                          >
                            •
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-xs text-gray-400 dark:text-zinc-500">
                          {section.lists.length}
                        </span>
                        <span
                          aria-hidden
                          className="shrink-0 text-gray-300 dark:text-zinc-600"
                        >
                          ›
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label className="mt-2 flex cursor-pointer items-center gap-2 border-t border-gray-100 pt-2.5 text-xs text-gray-500 dark:border-zinc-700 dark:text-zinc-400">
              <input
                type="checkbox"
                data-testid="move-item-copy"
                checked={copyMode}
                onChange={(e) => setCopyMode(e.target.checked)}
                className="h-3.5 w-3.5 accent-gray-900 dark:accent-white"
              />
              {t("copyMode")}
            </label>
          </>
        )}
      </div>
    </div>
  );
}
