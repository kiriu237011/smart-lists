/**
 * @file GroupFilter.tsx
 * @description Горизонтальная полоса фильтрации списков по группам.
 *
 * Показывает пилюли: "Все" (без фильтра) + по одной на каждую группу.
 * Активная пилюля — выделена. На каждой группе есть кнопка удаления
 * и двойной клик для переименования inline.
 * Кнопка "+" открывает inline-форму создания новой группы.
 */

"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { type ListGroup } from "@/components/lists/ListCard";

type GroupFilterProps = {
  groups: ListGroup[];
  activeGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, newName: string) => Promise<void>;
};

export default function GroupFilter({
  groups,
  activeGroupId,
  onSelectGroup,
  onCreateGroup,
  onDeleteGroup,
  onRenameGroup,
}: GroupFilterProps) {
  const t = useTranslations("GroupFilter");

  // Состояние формы создания новой группы
  const [isCreating, setIsCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createInputRef = useRef<HTMLInputElement>(null);

  // Состояние inline-редактирования группы
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Long press для мобильного переименования
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMobileEdit, setIsMobileEdit] = useState(false);

  const startLongPress = (group: ListGroup) => {
    longPressTimer.current = setTimeout(() => {
      setEditingGroupId(group.id);
      setEditingName(group.name);
      setIsMobileEdit(true);
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const cancelMobileEdit = () => {
    setEditingGroupId(null);
    setIsMobileEdit(false);
  };

  const handleCreateSubmit = async () => {
    const trimmed = newGroupName.trim();
    if (!trimmed || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onCreateGroup(trimmed);
      setNewGroupName("");
      setIsCreating(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRenameSubmit = async (groupId: string) => {
    const trimmed = editingName.trim();
    setEditingGroupId(null);
    if (!trimmed) return;
    const original = groups.find((g) => g.id === groupId)?.name;
    if (trimmed === original) return;
    await onRenameGroup(groupId, trimmed);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap mb-4 px-0.5">

      {/* Мобильное полноширинное редактирование */}
      {isMobileEdit && editingGroupId !== null ? (
        <div className="flex items-center gap-2 w-full">
          <input
            autoFocus
            value={editingName}
            maxLength={50}
            onChange={(e) => setEditingName(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleRenameSubmit(editingGroupId).then(cancelMobileEdit);
              }
              if (e.key === "Escape") cancelMobileEdit();
            }}
            className="flex-1 min-w-0 px-3 py-1 rounded-full text-sm font-medium border border-gray-400 dark:border-zinc-500 bg-white dark:bg-zinc-800 outline-none"
          />
          <button
            type="button"
            onClick={() => void handleRenameSubmit(editingGroupId).then(cancelMobileEdit)}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-sm text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-zinc-700 transition shrink-0"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={cancelMobileEdit}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-sm text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-600 dark:hover:text-zinc-300 transition shrink-0"
          >
            ✗
          </button>
        </div>
      ) : (
        <>
          {/* Пилюля "Все" */}
          <button
            type="button"
            onClick={() => onSelectGroup(null)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              activeGroupId === null
                ? "bg-gray-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700"
            }`}
          >
            {t("all")}
          </button>

          {/* Пилюли групп */}
          {groups.map((group) => (
            <div key={group.id} className="relative flex items-center group/pill">
              {editingGroupId === group.id ? (
                /* Inline-редактирование (десктоп, двойной клик) */
                <input
                  ref={editInputRef}
                  autoFocus
                  value={editingName}
                  maxLength={50}
                  onChange={(e) => setEditingName(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleRenameSubmit(group.id);
                    }
                    if (e.key === "Escape") {
                      setEditingGroupId(null);
                    }
                  }}
                  onBlur={() => void handleRenameSubmit(group.id)}
                  className="px-3 py-1 rounded-full text-sm font-medium border border-gray-400 dark:border-zinc-500 bg-white dark:bg-zinc-800 outline-none w-32"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onSelectGroup(group.id)}
                  onDoubleClick={() => {
                    setEditingGroupId(group.id);
                    setEditingName(group.name);
                  }}
                  onTouchStart={() => startLongPress(group)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`pl-3 pr-6 py-1 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                    activeGroupId === group.id
                      ? "bg-gray-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700"
                  }`}
                >
                  {group.name}
                </button>
              )}

              {/* Кнопка удаления группы */}
              {editingGroupId !== group.id && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteGroup(group.id);
                  }}
                  aria-label={t("ariaDeleteGroup", { name: group.name })}
                  className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center rounded-full text-xs transition-opacity ${
                    activeGroupId === group.id
                      ? "text-white/70 hover:text-white dark:text-zinc-900/60 dark:hover:text-zinc-900 opacity-100 sm:opacity-0 sm:group-hover/pill:opacity-100"
                      : "text-gray-400 hover:text-gray-700 dark:text-zinc-300 dark:hover:text-white opacity-0 sm:group-hover/pill:opacity-100"
                  }`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </>
      )}

      {/* Форма создания новой группы (скрыта при мобильном редактировании) */}
      {!isMobileEdit && isCreating ? (
        <div className="flex items-center gap-2">
          <input
            ref={createInputRef}
            autoFocus
            value={newGroupName}
            maxLength={50}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleCreateSubmit();
              }
              if (e.key === "Escape") {
                setIsCreating(false);
                setNewGroupName("");
              }
            }}
            onBlur={() => {
              if (!newGroupName.trim()) {
                setIsCreating(false);
                setNewGroupName("");
              }
            }}
            placeholder={t("newGroupPlaceholder")}
            disabled={isSubmitting}
            className="px-3 py-1 rounded-full text-sm border border-gray-400 dark:border-zinc-500 bg-white dark:bg-zinc-800 outline-none w-32 placeholder:text-gray-400"
          />
          <button
            type="button"
            onClick={() => void handleCreateSubmit()}
            disabled={isSubmitting || !newGroupName.trim()}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-sm text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-zinc-700 transition disabled:opacity-40"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCreating(false);
              setNewGroupName("");
            }}
            className="inline-flex items-center justify-center w-6 h-6 rounded text-sm text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-600 dark:hover:text-zinc-300 transition"
          >
            ✗
          </button>
        </div>
      ) : !isMobileEdit ? (
        /* Кнопка "+" для создания новой группы */
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          aria-label={t("ariaCreateGroup")}
          className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors text-base leading-none"
        >
          +
        </button>
      ) : null}
    </div>
  );
}
