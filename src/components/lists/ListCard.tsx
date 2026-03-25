/**
 * @file ListCard.tsx
 * @description Мемоизированная карточка одного списка покупок.
 *
 * Изолирует состояние редактирования заголовка внутри себя,
 * чтобы ре-рендер при поиске или изменении другой карточки не затрагивал её.
 *
 * Поддерживаемые функции:
 *   - Переименование заголовка (Enter — сохранить, Escape/blur — отменить).
 *   - Удаление списка (только для владельца).
 *   - Выход из расшаренного списка (кнопка "Отписаться").
 *   - Подсветка совпадений по поисковому запросу через компонент `Highlight`.
 *
 * Экспортирует вспомогательные типы:
 *   `SharedUser`, `ListOwner`, `Item`, `ListData`, `ListCardProps`.
 */

"use client";

import { memo, useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import SmartList from "@/components/lists/SmartList";
import Highlight from "@/components/ui/Highlight";
import ShareListForm from "@/components/lists/ShareListForm";

/** Пользователь, которому предоставлен доступ к списку. */
export type SharedUser = {
  id: string;
  name: string | null;
  email: string | null;
};

/** Данные о владельце списка. */
export type ListOwner = {
  name: string | null;
  email: string;
};

/** Запись внутри списка. */
export type Item = {
  id: string;
  name: string;
  isCompleted: boolean;
  addedBy: { id: string; name: string | null; email: string } | null;
};

/** Полные данные списка (включая связанные сущности). */
export type ListData = {
  id: string;
  title: string;
  ownerId: string;
  owner: ListOwner;
  items: Item[];
  sharedWith: SharedUser[];
};

/** Пропсы компонента `ListCard`. */
export type ListCardProps = {
  list: ListData;
  currentUserId: string;
  currentUserName: string | null;
  currentUserEmail: string;
  showAuthors: boolean;
  isDeleting: boolean;
  isLeaving: boolean;
  onRename: (listId: string, newTitle: string, originalList: ListData) => Promise<void>;
  onDelete: (list: ListData) => void;
  onLeave: (list: ListData) => void;
  /** Активный поисковый запрос для подсветки совпадений (пустая строка = нет поиска). */
  searchQuery: string;
};

/**
 * Мемоизированная карточка одного списка.
 *
 * Изолирует состояние редактирования (isEditing, editTitle) внутри себя,
 * чтобы ре-рендер при поиске или изменении другой карточки не затрагивал её.
 *
 * @param list - Данные списка.
 * @param currentUserId - ID авторизованного пользователя.
 * @param currentUserName - Имя авторизованного пользователя.
 * @param currentUserEmail - Email авторизованного пользователя.
 * @param showAuthors - Показывать ли авторов записей.
 * @param isDeleting - Идёт ли процесс удаления (блокирует кнопку ✕).
 * @param isLeaving - Идёт ли процесс выхода из списка (блокирует кнопку Отписаться).
 * @param onRename - Колбэк переименования списка.
 * @param onDelete - Колбэк открытия модала удаления.
 * @param onLeave - Колбэк открытия модала выхода из списка.
 * @param searchQuery - Текущий поисковый запрос для подсветки совпадений.
 */
const ListCard = memo(function ListCard({
  list,
  currentUserId,
  currentUserName,
  currentUserEmail,
  showAuthors,
  isDeleting,
  isLeaving,
  onRename,
  onDelete,
  onLeave,
  searchQuery,
}: ListCardProps) {
  const t = useTranslations("ListsContainer");

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const processingRenameRef = useRef(false);
  const skipBlurRef = useRef(false);

  const handleConfirmRename = useCallback(async () => {
    if (processingRenameRef.current) return;
    processingRenameRef.current = true;
    try {
      const trimmed = editTitle.trim();
      setIsEditing(false);
      if (!trimmed || trimmed === list.title) return;
      await onRename(list.id, trimmed, list);
    } finally {
      processingRenameRef.current = false;
    }
  }, [editTitle, list, onRename]);

  const isOwner = list.ownerId === currentUserId;
  const isTemp = list.id.startsWith("temp-");

  return (
    <div className="break-inside-avoid mb-6 border border-gray-100 dark:border-transparent p-6 rounded-xl shadow-sm dark:shadow-lg dark:shadow-black/50 bg-white dark:bg-zinc-900">
      {/* Заголовок и кнопки управления */}
      <div className="mb-4 border-b dark:border-zinc-700 pb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isEditing ? (
            <input
              autoFocus
              className="text-xl font-bold w-full border dark:border-zinc-700 p-1 rounded-lg bg-gray-50 dark:bg-zinc-800 focus:bg-white dark:focus:bg-zinc-900 focus:ring-1 ring-gray-800 dark:ring-zinc-400 outline-none transition"
              value={editTitle}
              maxLength={50}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleConfirmRename();
                }
                if (e.key === "Escape") {
                  skipBlurRef.current = true;
                  setIsEditing(false);
                }
              }}
              onBlur={() => {
                if (skipBlurRef.current) {
                  skipBlurRef.current = false;
                  return;
                }
                void handleConfirmRename();
              }}
            />
          ) : isOwner && !isTemp ? (
            <div
              className="group inline-flex items-center gap-1 min-w-0 rounded-lg px-1 -mx-1 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:ring-1 hover:ring-gray-300 dark:hover:ring-zinc-700 transition-colors cursor-pointer"
              onClick={() => {
                setIsEditing(true);
                setEditTitle(list.title);
              }}
            >
              <h2 className="text-xl font-bold truncate"><Highlight text={list.title} query={searchQuery} /></h2>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 dark:text-zinc-500 text-base flex-shrink-0">
                ✎
              </span>
            </div>
          ) : (
            <h2 className="text-xl font-bold truncate"><Highlight text={list.title} query={searchQuery} /></h2>
          )}
        </div>

        {/* Кнопки переименования и удаления: только для владельца и только для реальных списков */}
        {isOwner && !isTemp && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {isEditing ? (
              <>
                <button
                  type="button"
                  aria-label="Сохранить"
                  onMouseDown={() => { skipBlurRef.current = true; }}
                  onClick={() => void handleConfirmRename()}
                  className="hidden sm:inline-flex text-green-600 hover:text-white hover:bg-green-600 text-base px-2 py-1 leading-none rounded transition"
                >
                  ✓
                </button>
                <button
                  type="button"
                  aria-label="Отменить"
                  onMouseDown={() => { skipBlurRef.current = true; }}
                  onClick={() => setIsEditing(false)}
                  className="text-gray-400 hover:text-white hover:bg-gray-500 dark:hover:bg-zinc-600 text-base px-2 py-1 leading-none rounded transition"
                >
                  ✗
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label={t("ariaDelete", { title: list.title })}
                disabled={isDeleting}
                onClick={() => onDelete(list)}
                className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Skeleton-заглушка для temp-списка */}
      {isTemp && (
        <div className="space-y-2 animate-pulse" aria-hidden>
          <div className="h-4 bg-gray-100 dark:bg-zinc-800 rounded w-3/4" />
          <div className="h-4 bg-gray-100 dark:bg-zinc-800 rounded w-1/2" />
          <div className="h-4 bg-gray-100 dark:bg-zinc-800 rounded w-2/3" />
        </div>
      )}

      {/* Список записей */}
      {!isTemp && (
        <SmartList
          items={list.items}
          listId={list.id}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserEmail={currentUserEmail}
          showAuthors={showAuthors}
          searchQuery={searchQuery}
        />
      )}

      {/* Форма совместного доступа */}
      {isOwner && !isTemp && (
        <ShareListForm listId={list.id} sharedWith={list.sharedWith} />
      )}

      {/* Подпись владельца + кнопка Отписаться */}
      {!isOwner && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-zinc-700 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {t("owner", { name: list.owner.name || list.owner.email })}
          </span>
          <button
            type="button"
            disabled={isLeaving}
            onClick={() => onLeave(list)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 4h3a2 2 0 0 1 2 2v14" />
              <path d="M2 20h3" />
              <path d="M13 20h9" />
              <path d="M10 12v.01" />
              <path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z" />
            </svg>
            {t("unsubscribe")}
          </button>
        </div>
      )}
    </div>
  );
});

export default ListCard;
