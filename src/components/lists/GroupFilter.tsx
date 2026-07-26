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

import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ListGroup } from "@/components/lists/ListCard";
import { beginDrag, endDrag } from "@/lib/drag-gate";
import {
  getWrappedSortTransforms,
  type WrappedSortLayout,
} from "@/lib/wrapped-sort";

type GroupFilterProps = {
  groups: ListGroup[];
  activeGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onDeleteGroup: (groupId: string) => void;
  onRenameGroup: (groupId: string, newName: string) => Promise<void>;
  onMoveGroup: (groupId: string, orderedGroups: ListGroup[]) => Promise<void>;
  isReordering: boolean;
};

/**
 * Сортируемая обёртка одной пилюли.
 *
 * Весь элемент получает transform, но события DnD закреплены только за
 * отдельной ручкой. Поэтому клик по названию продолжает выбирать группу,
 * двойной клик — переименовывать, а вертикальный скролл страницы не
 * перехватывается за пределами ручки.
 */
function SortableGroupChip({
  group,
  showHandle,
  disabled,
  dragLabel,
  children,
}: {
  group: ListGroup;
  showHandle: boolean;
  disabled: boolean;
  dragLabel: string;
  children: (isDragging: boolean) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
  } = useSortable({ id: group.id, disabled });

  return (
    <div
      ref={setNodeRef}
      data-testid="group-sortable"
      data-group-id={group.id}
      style={{
        // rectSortingStrategy добавляет scale при обмене элементами разной
        // ширины. Для текстовых вкладок это заметно деформирует надпись, поэтому
        // применяем только перенос и сохраняем исходные размеры пилюли.
        transform: CSS.Translate.toString(transform),
        // При переносе между строками разные вкладки движутся по разным
        // траекториям и во время transition могут наехать друг на друга, даже
        // если их конечные позиции не пересекаются. Пока жест активен, сразу
        // ставим соседей в безопасные рассчитанные позиции.
        transition: isSorting ? "none" : transition,
      }}
      className={`relative flex items-center group/pill ${
        isDragging ? "z-30 opacity-90 drop-shadow-lg" : ""
      }`}
    >
      {showHandle && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          data-testid="group-drag-handle"
          disabled={disabled}
          {...attributes}
          {...listeners}
          aria-label={dragLabel}
          className={`peer/drag absolute left-1 z-10 inline-flex h-5 w-5 touch-none cursor-grab items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 ${
            isDragging
              ? "dark:text-zinc-100"
              : "dark:text-zinc-500 dark:hover:text-zinc-200"
          }`}
        >
          <GripVertical aria-hidden size={14} strokeWidth={2.2} />
        </button>
      )}
      {children(isDragging)}
    </div>
  );
}

export default function GroupFilter({
  groups,
  activeGroupId,
  onSelectGroup,
  onCreateGroup,
  onDeleteGroup,
  onRenameGroup,
  onMoveGroup,
  isReordering,
}: GroupFilterProps) {
  const t = useTranslations("GroupFilter");
  const filterRef = useRef<HTMLDivElement>(null);
  const sortingLayoutRef = useRef<WrappedSortLayout | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sortingStrategy = useCallback<SortingStrategy>(
    ({ rects, activeIndex, overIndex, index }) => {
      const layout = sortingLayoutRef.current;
      if (!layout) return null;
      return (
        getWrappedSortTransforms(rects, activeIndex, overIndex, layout)[index] ??
        null
      );
    },
    [],
  );

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
    if (isReordering) return;
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

  const handleDragStart = () => {
    cancelLongPress();
    const container = filterRef.current;
    if (container) {
      const bounds = container.getBoundingClientRect();
      const styles = window.getComputedStyle(container);
      sortingLayoutRef.current = {
        right: bounds.right - (Number.parseFloat(styles.paddingRight) || 0),
        wrappedRowLeft:
          bounds.left + (Number.parseFloat(styles.paddingLeft) || 0),
        columnGap: Number.parseFloat(styles.columnGap) || 0,
        rowGap: Number.parseFloat(styles.rowGap) || 0,
      };
    }
    beginDrag();
  };

  const handleDragCancel = () => {
    sortingLayoutRef.current = null;
    endDrag();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    sortingLayoutRef.current = null;
    endDrag();
    const { active, over } = event;
    if (!over || active.id === over.id || isReordering) return;

    const oldIndex = groups.findIndex((group) => group.id === active.id);
    const newIndex = groups.findIndex((group) => group.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const orderedGroups = arrayMove(groups, oldIndex, newIndex);
    void onMoveGroup(String(active.id), orderedGroups);
  };

  const groupName = (id: string | number) =>
    groups.find((group) => group.id === id)?.name ?? "";

  const groupPosition = (id: string | number) =>
    Math.max(1, groups.findIndex((group) => group.id === id) + 1);

  return (
    <div
      ref={filterRef}
      className="mb-4 flex flex-wrap items-center gap-2 px-0.5"
    >

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
            data-testid="group-all"
            onClick={() => onSelectGroup(null)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
              activeGroupId === null
                ? "bg-gray-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700"
            }`}
          >
            {t("all")}
          </button>

          {/* "Все" не входит в SortableContext и физически не может сдвинуться. */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragCancel={handleDragCancel}
            onDragEnd={handleDragEnd}
            accessibility={{
              screenReaderInstructions: {
                draggable: t("dragInstructions"),
              },
              announcements: {
                onDragStart: ({ active }) =>
                  t("dragStart", { name: groupName(active.id) }),
                onDragOver: ({ active, over }) =>
                  over
                    ? t("dragOver", {
                        name: groupName(active.id),
                        position: groupPosition(over.id),
                      })
                    : undefined,
                onDragEnd: ({ active, over }) =>
                  over
                    ? t("dragEnd", {
                        name: groupName(active.id),
                        position: groupPosition(over.id),
                      })
                    : t("dragCancel", { name: groupName(active.id) }),
                onDragCancel: ({ active }) =>
                  t("dragCancel", { name: groupName(active.id) }),
              },
            }}
          >
            <SortableContext
              items={groups.map((group) => group.id)}
              strategy={sortingStrategy}
            >
              {groups.map((group) => {
                const showHandle =
                  groups.length > 1 &&
                  activeGroupId === group.id &&
                  editingGroupId !== group.id;
                return (
                  <SortableGroupChip
                    key={group.id}
                    group={group}
                    showHandle={showHandle}
                    disabled={isReordering || editingGroupId === group.id}
                    dragLabel={t("ariaDragGroup", {
                      name: group.name,
                      position: groupPosition(group.id),
                      count: groups.length,
                    })}
                  >
                    {(isDragging) => (
                      <>
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
                            className="w-32 rounded-full border border-gray-400 bg-white px-3 py-1 text-sm font-medium outline-none dark:border-zinc-500 dark:bg-zinc-800"
                          />
                        ) : (
                          <button
                            type="button"
                            data-testid="group-chip"
                            data-group-id={group.id}
                            data-active={activeGroupId === group.id}
                            onClick={() => onSelectGroup(group.id)}
                            onDoubleClick={() => {
                              if (isReordering) return;
                              setEditingGroupId(group.id);
                              setEditingName(group.name);
                            }}
                            onTouchStart={() => startLongPress(group)}
                            onTouchEnd={cancelLongPress}
                            onTouchMove={cancelLongPress}
                            onContextMenu={(e) => e.preventDefault()}
                            className={`${showHandle ? "pl-7" : "pl-3"} ${
                              activeGroupId === group.id ? "pr-6" : "pr-3"
                            } whitespace-nowrap rounded-full py-1 text-sm font-medium transition-colors ${
                              activeGroupId === group.id
                                ? `bg-gray-800 text-white ${
                                    isDragging
                                      ? "dark:bg-zinc-700 dark:text-zinc-100"
                                      : "dark:bg-zinc-100 dark:text-zinc-900 dark:peer-hover/drag:bg-zinc-700 dark:peer-hover/drag:text-zinc-100"
                                  }`
                                : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                            }`}
                          >
                            {group.name}
                          </button>
                        )}

                        {editingGroupId !== group.id &&
                          activeGroupId === group.id && (
                            <button
                              type="button"
                              disabled={isReordering}
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteGroup(group.id);
                              }}
                              aria-label={t("ariaDeleteGroup", {
                                name: group.name,
                              })}
                              className={`absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                isDragging
                                  ? "text-white/70 hover:text-white dark:text-zinc-100/70 dark:hover:text-zinc-100"
                                  : "text-white/70 hover:text-white dark:text-zinc-900/60 dark:hover:text-zinc-900 dark:peer-hover/drag:text-zinc-100/70 dark:peer-hover/drag:hover:text-zinc-100"
                              }`}
                            >
                              ✕
                            </button>
                          )}
                      </>
                    )}
                  </SortableGroupChip>
                );
              })}
            </SortableContext>
          </DndContext>
        </>
      )}

      {/* Форма создания новой группы (скрыта при мобильном редактировании) */}
      {!isMobileEdit && isCreating ? (
        <div className="flex items-center gap-2">
          <input
            ref={createInputRef}
            autoFocus
            data-testid="group-create-input"
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
            disabled={isSubmitting || isReordering}
            className="px-3 py-1 rounded-full text-sm border border-gray-400 dark:border-zinc-500 bg-white dark:bg-zinc-800 outline-none w-32 placeholder:text-gray-400"
          />
          <button
            type="button"
            data-testid="group-create-submit"
            onClick={() => void handleCreateSubmit()}
            disabled={isSubmitting || isReordering || !newGroupName.trim()}
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
          data-testid="group-create-open"
          disabled={isReordering}
          onClick={() => setIsCreating(true)}
          aria-label={t("ariaCreateGroup")}
          className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-800 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors text-base leading-none disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      ) : null}
    </div>
  );
}
