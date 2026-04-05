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

import { memo, useCallback, useEffect, useRef, useState } from "react";
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

/** Группа списков (минимальные данные для отображения). */
export type ListGroup = {
  id: string;
  name: string;
};

/** Полные данные списка (включая связанные сущности). */
export type ListData = {
  id: string;
  title: string;
  ownerId: string;
  owner: ListOwner;
  items: Item[];
  sharedWith: SharedUser[];
  /** Группы текущего пользователя, в которых находится этот список. */
  groups: ListGroup[];
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
  /** Все группы пользователя (для меню назначения в группу). */
  userGroups: ListGroup[];
  /** Колбэк добавления/удаления списка из группы. */
  onToggleListGroup: (listId: string, groupId: string, inGroup: boolean) => Promise<void>;
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
  userGroups,
  onToggleListGroup,
}: ListCardProps) {
  const t = useTranslations("ListsContainer");

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const processingRenameRef = useRef(false);
  const skipBlurRef = useRef(false);

  // Состояние дропдауна меню групп
  const [isGroupMenuOpen, setIsGroupMenuOpen] = useState(false);
  const groupMenuRef = useRef<HTMLDivElement>(null);

  // Закрываем меню при клике вне его
  useEffect(() => {
    if (!isGroupMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(e.target as Node)) {
        setIsGroupMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isGroupMenuOpen]);

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
                  className="hidden sm:inline-flex items-center justify-center w-6 h-6 rounded text-sm text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-zinc-700 transition"
                >
                  ✓
                </button>
                <button
                  type="button"
                  aria-label="Отменить"
                  onMouseDown={() => { skipBlurRef.current = true; }}
                  onClick={() => setIsEditing(false)}
                  className="inline-flex items-center justify-center w-6 h-6 rounded text-sm text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-600 dark:hover:text-zinc-300 transition"
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

      {/* Меню назначения в группу */}
      {!isTemp && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-700 flex items-center justify-between">
          <div className="relative" ref={groupMenuRef}>
            <button
              type="button"
              onClick={() => setIsGroupMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors"
              aria-label={t("ariaGroupMenu")}
            >
              {list.groups.length > 0 ? (
                /* Бейджи групп — список состоит в группе */
                <span className="flex items-center gap-1 flex-wrap">
                  {list.groups.map((g) => (
                    <span
                      key={g.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                    >
                      {g.name}
                    </span>
                  ))}
                </span>
              ) : (
                /* Иконка папки с плюсом — группа не назначена */
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                  {t("noGroup")}
                </>
              )}
            </button>

            {/* Дропдаун со списком групп */}
            {isGroupMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1 z-20 min-w-44 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg shadow-lg py-1">
                {userGroups.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400 dark:text-zinc-500">
                    {t("noGroupsHint")}
                  </p>
                ) : (
                  userGroups.map((group) => {
                    const inGroup = list.groups.some((g) => g.id === group.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => {
                          void onToggleListGroup(list.id, group.id, inGroup);
                          setIsGroupMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors text-left"
                      >
                        <span className={`w-4 h-4 flex-shrink-0 flex items-center justify-center rounded text-xs ${
                          inGroup
                            ? "bg-gray-800 dark:bg-zinc-200 text-white dark:text-zinc-900"
                            : "border border-gray-300 dark:border-zinc-600"
                        }`}>
                          {inGroup && "✓"}
                        </span>
                        <span className="truncate">{group.name}</span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
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
