/**
 * @file SmartList.tsx
 * @description Компонент отдельного списка с поддержкой оптимистичных обновлений.
 *
 * Client Component (`"use client"`).
 *
 * Отображает список записей и форму добавления новой записи.
 * Все три операции (добавление, удаление, переключение статуса) реализованы
 * с оптимистичным обновлением: UI меняется МГНОВЕННО, а запрос к серверу
 * выполняется в фоне.
 *
 * Паттерн "оптимистичный ID":
 *   При добавлении запись получает временный ID `temp-<timestamp>`.
 *   Пока запись имеет такой ID, она визуально помечается как "сохраняется":
 *     - Полупрозрачность (opacity-60)
 *     - Анимированный спиннер вместо чекбокса
 *     - Надпись "Сохраняется..." рядом с названием
 *   После ответа сервера `revalidatePath("/")` заменяет временную запись реальной.
 *
 * Откат при ошибке (только для addItem):
 *   Если сервер вернул ошибку — временная запись удаляется из UI,
 *   а введённое название возвращается в поле ввода.
 */

"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Reorder, useDragControls, type DragControls } from "framer-motion";
import { beginItemDrag, endItemDrag } from "@/lib/drag-gate";
import { useListsApi } from "@/components/providers/ListsApiProvider";
import toast from "react-hot-toast";
import { useTranslations } from "next-intl";
import Highlight from "@/components/ui/Highlight";
import {
  DeleteNoteModal,
  NoteIcon,
  NotePanel,
  NoteRemoveIcon,
  TrashIcon,
} from "@/components/lists/Notes";
import { getNoteExcerpt } from "@/lib/notes";

// ---------------------------------------------------------------------------
// Типы данных
// ---------------------------------------------------------------------------

/** Одна запись в списке. */
type Item = {
  id: string;
  name: string;
  note: string | null;
  noteVersion: number;
  isCompleted: boolean;
  /** Пользователь, добавивший запись. null — для старых записей или temp-записей. */
  addedBy: { id: string; name: string | null; email: string } | null;
};

/** Пропсы компонента `SmartList`. */
type SmartListProps = {
  /** Начальные данные о записях (загружаются с сервера). */
  items: Item[];
  /** ID списка, которому принадлежат эти записи. */
  listId: string;
  /** ID текущего пользователя (для отображения "Вы" вместо имени). */
  currentUserId: string;
  /** Имя текущего пользователя (для оптимистичного addedBy). */
  currentUserName: string | null;
  /** Email текущего пользователя (для оптимистичного addedBy). */
  currentUserEmail: string;
  /** Глобальный флаг отображения авторов (управляется из ListsContainer). */
  showAuthors: boolean;
  /** Глобальный флаг отображения порядковых номеров (тумблер в настройках). */
  showItemNumbers: boolean;
  /**
   * ID записей, совпавших с поиском. null — показывать все записи.
   * Список приходит целиком именно для того, чтобы номера считались по нему,
   * а не по совпавшему подмножеству.
   */
  visibleItemIds: Set<string> | null;
  /** Активный поисковый запрос для подсветки совпадений (пустая строка = нет поиска). */
  searchQuery?: string;
};

// ---------------------------------------------------------------------------
// Иконки перемещения
// ---------------------------------------------------------------------------

/** Стрелка вверх для пункта меню «Переместить выше». */
function MoveUpIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

/** Стрелка вниз для пункта меню «Переместить ниже». */
function MoveDownIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

/** Ручка перетаскивания: две колонки точек — привычный «grip». */
function GripIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Перетаскиваемая строка
// ---------------------------------------------------------------------------

/**
 * Обёртка строки, которую можно перетаскивать.
 *
 * Существует отдельным компонентом ради `useDragControls`: это хук, а значит
 * вызвать его в цикле по записям внутри `SmartList` нельзя — нужен один
 * компонент на строку.
 *
 * `dragListener={false}` отключает захват жеста самой строкой: перетаскивание
 * начинается ТОЛЬКО с ручки. Иначе жест конфликтовал бы с кликом по названию
 * (он открывает редактирование) и с вертикальным скроллом страницы на телефоне.
 */
function DraggableItemRow({
  item,
  className,
  onDragStart,
  onDragEnd,
  children,
}: {
  item: Item;
  className: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  children: (dragControls: DragControls) => ReactNode;
}) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      as="li"
      value={item}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // Инерция после отпускания в списке читается как «строка отскочила»:
      // запись должна замереть там, где её отпустили.
      dragMomentum={false}
      // Небольшое сопротивление на краях группы: строка не улетает за пределы
      // списка, но и не выглядит намертво прибитой.
      dragElastic={0.12}
      // Подъём строки под курсором. Тень и масштаб дают физическое ощущение
      // «взяли в руку»; без этого строка визуально неотличима от остальных.
      whileDrag={{ scale: 1.02 }}
      className={className}
    >
      {children(dragControls)}
    </Reorder.Item>
  );
}

// ---------------------------------------------------------------------------
// Компонент
// ---------------------------------------------------------------------------

/**
 * Компонент списка записей с оптимистичными обновлениями.
 *
 * @param items - Начальный массив записей (с сервера).
 * @param listId - ID списка для привязки новых записей.
 */
export default function SmartList({
  items,
  listId,
  currentUserId,
  currentUserName,
  currentUserEmail,
  showAuthors,
  showItemNumbers,
  visibleItemIds,
  searchQuery = "",
}: SmartListProps) {
  const t = useTranslations("SmartList");
  const notesT = useTranslations("Notes");

  // Адаптер операций: Server Actions (авторизованный) или localStorage (гость)
  const api = useListsApi();

  /**
   * Оптимистичный массив записей.
   *
   * `useOptimistic` принимает:
   *   - начальное состояние (`items` с сервера)
   *   - reducer-функцию, описывающую как изменить состояние локально
   *
   * Поддерживаемые действия:
   *   - `toggle`  — инвертирует `isCompleted` у записи с заданным `itemId`.
   *   - `delete`  — удаляет запись с заданным `itemId` из массива.
   *   - `add`     — добавляет временную запись с `itemId` как временным ID.
   *   - `rename`  — меняет название записи.
   *   - `move`    — меняет местами запись и соседнюю по направлению `direction`.
   *   - `reorder` — задаёт произвольный порядок невыполненных записей
   *                 (результат перетаскивания).
   */
  const [optimisticItems, setOptimisticItems] = useOptimistic(
    items,
    (
      state,
      {
        action,
        itemId,
        itemName,
        addedBy,
        direction,
        orderedIds,
      }: {
        action: "toggle" | "delete" | "add" | "rename" | "move" | "reorder";
        itemId: string;
        itemName?: string;
        addedBy?: Item["addedBy"];
        direction?: "up" | "down";
        orderedIds?: string[];
      },
    ) => {
      switch (action) {
        case "toggle":
          return state.map((item) =>
            item.id === itemId
              ? { ...item, isCompleted: !item.isCompleted }
              : item,
          );
        case "delete":
          return state.filter((item) => item.id !== itemId);
        case "add":
          return [
            ...state,
            {
              id: itemId,
              name: itemName || "",
              note: null,
              noteVersion: 0,
              isCompleted: false,
              addedBy: addedBy ?? null,
            },
          ];
        case "rename":
          return state.map((item) =>
            item.id === itemId
              ? { ...item, name: itemName || item.name }
              : item,
          );
        case "move": {
          // Меняем местами соседние НЕВЫПОЛНЕННЫЕ записи. Переставляем именно
          // слоты в массиве: выполненные записи между ними остаются на месте,
          // а сортировка при рендере стабильна — относительный порядок двух
          // активных записей меняется ровно так, как ожидает пользователь.
          const activeSlots = state.reduce<number[]>((slots, item, index) => {
            if (!item.isCompleted) slots.push(index);
            return slots;
          }, []);

          const from = activeSlots.findIndex(
            (slot) => state[slot].id === itemId,
          );
          if (from === -1) return state;

          const to = direction === "up" ? from - 1 : from + 1;
          if (to < 0 || to >= activeSlots.length) return state;

          const next = [...state];
          const a = activeSlots[from];
          const b = activeSlots[to];
          [next[a], next[b]] = [next[b], next[a]];
          return next;
        }
        case "reorder": {
          if (!orderedIds) return state;

          // Невыполненные выстраиваются по присланному порядку, выполненные
          // сохраняют свой относительный. Активные идут первыми — рендер всё
          // равно сортирует их вперёд, поэтому массив можно не переплетать.
          const rank = new Map(orderedIds.map((id, index) => [id, index]));
          const active = state
            .filter((item) => !item.isCompleted)
            .sort(
              (a, b) =>
                (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
                (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
            );
          return [...active, ...state.filter((item) => item.isCompleted)];
        }
        default:
          return state;
      }
    },
  );

  /** Текущее значение поля ввода новой записи. */
  const [newItemName, setNewItemName] = useState("");

  /** Флаг ожидания ответа сервера при добавлении записи. */
  const [isAddingItem, setIsAddingItem] = useState(false);

  /**
   * Запись, ожидающая подтверждения удаления.
   * `null` означает, что модальное окно закрыто.
   */
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);

  /** Флаг ожидания ответа сервера при удалении записи. Блокирует повторные запросы. */
  const [isDeletingItem, setIsDeletingItem] = useState(false);

  /** ID записи, название которой сейчас редактируется. */
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  /** Текущее значение поля ввода при редактировании записи. */
  const [editItemName, setEditItemName] = useState("");

  /** ID записи с раскрытой заметкой. */
  const [openNoteItemId, setOpenNoteItemId] = useState<string | null>(null);

  /** ID записи, заметку которой подтверждают к удалению из меню действий. */
  const [noteToDeleteItemId, setNoteToDeleteItemId] = useState<string | null>(null);

  /** ID записи с открытым меню действий. */
  const [openItemActionsId, setOpenItemActionsId] = useState<string | null>(null);
  const itemActionsMenuRef = useRef<HTMLDivElement>(null);
  const itemActionsButtonRef = useRef<HTMLButtonElement>(null);

  /** Защита от двойного вызова rename (Enter → blur). */
  const processingItemRenameRef = useRef(false);

  /** Сигнал для игнорирования blur при нажатии Escape. */
  const skipItemBlurRef = useRef(false);

  /**
   * Обработчик подтверждения удаления записи.
   *
   * Вызывается из модального окна или по нажатию Enter.
   * Выполняет оптимистичное удаление.
   */
  const handleConfirmDeleteItem = useCallback(async () => {
    if (!itemToDelete) return;

    const item = itemToDelete;
    setIsDeletingItem(true);
    setItemToDelete(null); // Закрываем модал немедленно

    // Оптимистично убираем запись из UI
    startTransition(() => {
      setOptimisticItems({ action: "delete", itemId: item.id });
    });

    await api.deleteItem(item.id);

    setIsDeletingItem(false);
  }, [itemToDelete, setOptimisticItems, api]);

  /**
   * Эффект: подписка на клавиатурные события при открытом модале удаления записи.
   *
   * - `Escape` — закрывает модал без удаления.
   * - `Enter`  — подтверждает удаление.
   */
  useEffect(() => {
    if (!itemToDelete) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setItemToDelete(null);
        return;
      }
      if (event.key === "Enter" && !isDeletingItem) {
        event.preventDefault();
        void handleConfirmDeleteItem();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleConfirmDeleteItem, isDeletingItem, itemToDelete]);

  // Закрываем меню действий записи по клику снаружи или по Escape.
  useEffect(() => {
    if (!openItemActionsId) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!itemActionsMenuRef.current?.contains(event.target as Node)) {
        setOpenItemActionsId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenItemActionsId(null);
        itemActionsButtonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openItemActionsId]);

  /**
   * Подтверждает переименование записи.
   * Вызывается при Enter или blur.
   */
  const handleConfirmItemRename = async (item: Item) => {
    if (processingItemRenameRef.current) return;
    processingItemRenameRef.current = true;

    try {
      const trimmedName = editItemName.trim();
      setEditingItemId(null);

      if (!trimmedName || trimmedName === item.name) return;

      startTransition(() => {
        setOptimisticItems({
          action: "rename",
          itemId: item.id,
          itemName: trimmedName,
        });
      });

      const result = await api.renameItem(item.id, trimmedName);

      if (result && !result.success) {
        startTransition(() => {
          setOptimisticItems({
            action: "rename",
            itemId: item.id,
            itemName: item.name,
          });
        });
        toast.error(
          result.error === "tooLong"
            ? t("errors.tooLong")
            : t("errors.renameFailed"),
        );
      }
    } finally {
      processingItemRenameRef.current = false;
    }
  };

  /**
   * Запись, заметку которой подтверждают к удалению.
   * Берём её из актуального массива, чтобы удалять с последней известной версией.
   */
  const noteDeleteItem =
    optimisticItems.find((item) => item.id === noteToDeleteItemId) ?? null;

  /**
   * Порядок отображения: невыполненные сверху, внутри группы — порядок,
   * пришедший с сервера (по position). Sort в JS стабилен по спецификации,
   * поэтому позиционный порядок внутри каждой группы сохраняется — благодаря
   * этому выполненные записи тоже идут по position, а не «как получится».
   */
  const orderedItems = [...optimisticItems].sort(
    (a, b) => Number(a.isCompleted) - Number(b.isCompleted),
  );

  /**
   * Видимые номера записей.
   *
   * Номер нигде не хранится — это порядковый индекс среди НЕВЫПОЛНЕННЫХ
   * записей. Отсюда бесплатно следуют все правила: удалили запись —
   * последующие сдвинулись на -1; отметили выполненной — она потеряла номер,
   * последующие сдвинулись на -1; сняли галку — вернулась на своё место
   * вместе со своим номером.
   *
   * Считается по optimisticItems, то есть по полному списку и с учётом
   * оптимистичных изменений: номера пересчитываются мгновенно, не дожидаясь
   * ответа сервера, и не врут при активном поиске.
   */
  const itemNumbers = new Map<string, number>();
  let activeItemsCount = 0;
  for (const item of orderedItems) {
    if (!item.isCompleted) {
      activeItemsCount += 1;
      itemNumbers.set(item.id, activeItemsCount);
    }
  }

  /**
   * Записи к отрисовке. При активном поиске несовпавшие скрываются здесь, а не
   * в `ListsContainer` — иначе нумерация считалась бы по подмножеству.
   * Только что добавленная запись (temp-) видна всегда: пользователь должен
   * видеть результат своего действия независимо от текущего фильтра.
   */
  const visibleItems = visibleItemIds
    ? orderedItems.filter(
        (item) => visibleItemIds.has(item.id) || item.id.startsWith("temp-"),
      )
    : orderedItems;

  /**
   * Порядок можно менять, только когда виден весь список. При активном поиске
   * пользователь видит подмножество записей, и «вверх» означало бы перескок
   * через скрытые записи — вместо этого пункты меню просто не показываются.
   */
  const canReorderItems = visibleItemIds === null && activeItemsCount > 1;

  /**
   * Перемещает запись на одну позицию вверх или вниз среди невыполненных.
   *
   * Серверу отправляются ID новых соседей, вычисленные по УЖЕ переставленному
   * массиву: сервер получает место назначения, а не наше представление о
   * текущем порядке, и потому не зависит от того, насколько оно свежее.
   */
  const handleMoveItem = (item: Item, direction: "up" | "down") => {
    const activeItems = orderedItems.filter((entry) => !entry.isCompleted);
    const index = activeItems.findIndex((entry) => entry.id === item.id);
    if (index === -1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= activeItems.length) return;

    const reordered = [...activeItems];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    // Запрос выполняется ВНУТРИ transition, как в form action у чекбокса:
    // оптимистичное значение живёт, пока transition не завершится. Если бы
    // await стоял снаружи, запись прыгнула бы обратно сразу после клика и
    // вернулась на новое место только после ответа сервера.
    startTransition(async () => {
      setOptimisticItems({ action: "move", itemId: item.id, direction });

      const result = await api.moveItem(
        item.id,
        reordered[targetIndex - 1]?.id ?? null,
        reordered[targetIndex + 1]?.id ?? null,
      );

      if (result && !result.success) {
        // Откат: обратное перемещение возвращает запись на прежнее место.
        setOptimisticItems({
          action: "move",
          itemId: item.id,
          direction: direction === "up" ? "down" : "up",
        });
        toast.error(t("errors.moveFailed"));
      }
    });
  };

  /** Невыполненные записи — те, что можно перетаскивать. */
  const activeVisibleItems = visibleItems.filter((item) => !item.isCompleted);
  /** Выполненные записи — рендерятся ниже обычным списком, без перетаскивания. */
  const completedVisibleItems = visibleItems.filter((item) => item.isCompleted);

  /** Порядок, который пользователь «набрал» жестом. null — жест не идёт. */
  const [dragOrder, setDragOrder] = useState<Item[] | null>(null);

  /** Порядок, показываемый группой: во время жеста — набранный, иначе серверный. */
  const draggableItems = dragOrder ?? activeVisibleItems;

  /** ID записи под курсором во время жеста. null — жест не идёт. */
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);

  /**
   * Классы строки.
   *
   * `transition-colors`, а НЕ `transition-all`: перетаскиваемую строку двигает
   * framer-motion через inline `transform`, и CSS-переход по всем свойствам
   * начинал бы его догонять — строка дёргалась бы и отставала от курсора.
   *
   * Во время жеста строка получает непрозрачный фон: в тёмной теме обычный фон
   * строки прозрачный, и без этого сквозь «поднятую» запись просвечивали бы
   * соседние — ровно то ощущение, что ничего не перетаскивается.
   */
  const rowClassName = (item: Item) => {
    const base = "py-2 px-1 transition-colors duration-200";
    if (item.id === draggingItemId) {
      return `${base} relative z-20 cursor-grabbing rounded-md bg-white shadow-lg ring-1 ring-gray-200 dark:bg-zinc-800 dark:shadow-black/60 dark:ring-zinc-700`;
    }
    return `${base} ${
      item.isCompleted
        ? "bg-gray-100 dark:bg-transparent"
        : "bg-gray-50 dark:bg-transparent"
    }`;
  };

  const handleDragStart = (item: Item) => {
    // Закрываем затвор realtime: перерисовка дерева посреди жеста сорвала бы его.
    beginItemDrag();
    setDraggingItemId(item.id);
    // Фиксируем текущий порядок как стартовый — дальше им управляет onReorder.
    setDragOrder(activeVisibleItems);
  };

  /**
   * Завершает жест: сохраняет набранный порядок и открывает затвор realtime.
   *
   * Соседи берутся из ИТОГОВОГО порядка, поэтому серверу уходит место
   * назначения — тот же контракт, что и у перемещения через меню.
   */
  const handleDragEnd = (item: Item) => {
    endItemDrag();
    setDraggingItemId(null);

    const finalOrder = dragOrder;
    setDragOrder(null);
    if (!finalOrder) return;

    const index = finalOrder.findIndex((entry) => entry.id === item.id);
    // Запись вернулась на исходное место — сохранять нечего.
    if (index === -1 || activeVisibleItems[index]?.id === item.id) return;

    const orderedIds = finalOrder.map((entry) => entry.id);
    const previousIds = activeVisibleItems.map((entry) => entry.id);

    startTransition(async () => {
      setOptimisticItems({ action: "reorder", itemId: item.id, orderedIds });

      const result = await api.moveItem(
        item.id,
        finalOrder[index - 1]?.id ?? null,
        finalOrder[index + 1]?.id ?? null,
      );

      if (result && !result.success) {
        setOptimisticItems({
          action: "reorder",
          itemId: item.id,
          orderedIds: previousIds,
        });
        toast.error(t("errors.moveFailed"));
      }
    });
  };

  /**
   * Рендерит содержимое строки записи.
   *
   * Вынесено в функцию, потому что строки живут в двух разных контейнерах:
   * активные — внутри Reorder.Group как Reorder.Item, остальные — обычными
   * li. Тело у них одинаковое, различается только обёртка и наличие ручки
   * перетаскивания.
   *
   * @param dragControls - Контроллер жеста; null у неперетаскиваемых строк.
   */
  const renderItemRow = (item: Item, dragControls: DragControls | null) => {
    /**
     * Запись считается "в ожидании" (pending), если её ID начинается с "temp-".
     * В этом состоянии интерактивные элементы заблокированы.
     */
    const isPending = item.id.startsWith("temp-");
    /** Номер записи. undefined у выполненных — они нумерацию теряют. */
    const itemNumber = itemNumbers.get(item.id);
    // Номер — это позиция среди активных записей, начиная с 1,
    // поэтому границы списка проверяются прямо по нему.
    const canMoveUp = itemNumber !== undefined && itemNumber > 1;
    const canMoveDown =
      itemNumber !== undefined && itemNumber < activeItemsCount;
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    const noteMatchesSearch = Boolean(
      item.note &&
        normalizedQuery &&
        item.note.toLocaleLowerCase().includes(normalizedQuery),
    );

    /**
     * Отступ заметки под названием записи — сумма ширин колонок слева от него.
     * Значения привязаны к классам самих колонок: чекбокс даёт 2rem
     * (w-5 + gap-3), ручка и номер по 1.75rem (та же пара минус отрицательный
     * margin, которым они подтянуты к соседу). Менять классы колонок — менять
     * и эти значения, иначе заметка съедет относительно текста.
     */
    const rowIndent =
      dragControls && showItemNumbers
        ? "ml-[5.5rem]"
        : dragControls || showItemNumbers
          ? "ml-[3.75rem]"
          : "ml-8";

    return (
      <>
          <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Ручка перетаскивания. aria-hidden и tabIndex -1 намеренно:
                жест доступен только мышью и пальцем, а с клавиатуры порядок
                меняется пунктами «Переместить выше/ниже» в меню действий —
                они и есть доступная альтернатива. touch-none обязателен:
                без него палец на ручке скроллил бы страницу вместо жеста. */}
            {dragControls && (
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                disabled={isPending}
                onPointerDown={(event) => {
                  if (!isPending) dragControls.start(event);
                }}
                className="-ml-1 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-gray-400 transition-colors hover:text-gray-600 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-600 dark:hover:text-zinc-300"
              >
                <GripIcon />
              </button>
            )}

            {/* Порядковый номер в виде «1.» — как в обычном нумерованном
                списке: точка сама сообщает, что это нумерация, без
                утяжеления шрифтом. Выполненная запись номер не получает,
                но колонку сохраняет — иначе блок выполненных «уезжает»
                влево. Выравнивание по правому краю плюс tabular-nums
                держат точки в одной вертикали при переходе 9 → 10. */}
            {showItemNumbers && (
              <span
                aria-hidden
                className="-mr-1 min-w-5 shrink-0 text-right text-sm tabular-nums text-gray-400 dark:text-zinc-500"
              >
                {itemNumber ? `${itemNumber}.` : ""}
              </span>
            )}

            {/* Кнопка переключения статуса (чекбокс): invisible при редактировании */}
            <form
              className={editingItemId === item.id ? "invisible" : ""}
              action={async () => {
                // 1. Мгновенно меняем UI
                setOptimisticItems({
                  action: "toggle",
                  itemId: item.id,
                });

                // 2. Сохраняем инверсию текущего статуса в фоне
                await api.toggleItem(item.id, item.isCompleted);
              }}
            >
              <button
                type="submit"
                disabled={isPending}
                title={isPending ? t("saving") : undefined}
                className={`w-5 h-5 border-2 rounded flex items-center justify-center transition-all duration-200 flex-shrink-0 ${
                  isPending
                    ? "border-gray-300 dark:border-zinc-700 cursor-not-allowed"
                    : item.isCompleted
                      ? "bg-gray-600 border-gray-600 dark:bg-zinc-500 dark:border-zinc-500 scale-105 shadow-sm shadow-gray-200 dark:shadow-none"
                      : "bg-white dark:bg-zinc-900 border-gray-300 dark:border-zinc-600 hover:border-gray-500 dark:hover:border-zinc-400 hover:shadow-sm"
                }`}
              >
                {isPending ? (
                  // Спиннер для ожидающей записи
                  <span className="block w-2.5 h-2.5 border-2 border-gray-400 dark:border-zinc-500 !border-t-transparent rounded-full animate-spin" />
                ) : (
                  // Галочка для выполненной записи
                  item.isCompleted && (
                    <svg
                      className="w-3 h-3 text-white"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
                      <path
                        d="M2 6.5l3 3 5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )
                )}
              </button>
            </form>

            {/* Название записи (или поле редактирования) + "Сохраняется..." */}
            <div
              className={`flex-1 min-w-0 flex items-center gap-1 rounded-lg px-1 -mx-1 transition-colors ${
                !isPending && !item.isCompleted && editingItemId !== item.id
                  ? "group cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-700 hover:ring-1 hover:ring-gray-300 dark:hover:ring-zinc-600"
                  : ""
              }`}
              onClick={
                !isPending && !item.isCompleted && editingItemId !== item.id
                  ? () => {
                      setOpenNoteItemId(null);
                      setOpenItemActionsId(null);
                      setEditingItemId(item.id);
                      setEditItemName(item.name);
                    }
                  : undefined
              }
            >
              {!isPending && editingItemId === item.id ? (
                <textarea
                  autoFocus
                  autoComplete="off"
                  value={editItemName}
                  maxLength={200}
                  rows={1}
                  onFocus={(e) => {
                    e.target.select();
                    e.target.style.height = "auto";
                    e.target.style.height = e.target.scrollHeight + "px";
                  }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = el.scrollHeight + "px";
                  }}
                  onChange={(e) => setEditItemName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleConfirmItemRename(item);
                    }
                    if (e.key === "Escape") {
                      skipItemBlurRef.current = true;
                      setEditingItemId(null);
                    }
                  }}
                  onBlur={() => {
                    if (skipItemBlurRef.current) {
                      skipItemBlurRef.current = false;
                      return;
                    }
                    void handleConfirmItemRename(item);
                  }}
                  className="text-sm border dark:border-zinc-600 py-2 px-1 rounded-lg bg-gray-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 focus:ring-1 ring-gray-800 dark:ring-zinc-500 outline-none transition w-full min-w-0 resize-none overflow-hidden"
                />
              ) : isPending || (!item.isCompleted) ? (
                <>
                  <span className="flex-1"><Highlight text={item.name} query={searchQuery} /></span>
                  {!isPending && <span className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 text-xs flex-shrink-0">✎</span>}
                </>
              ) : (
                <span className="transition-all duration-200 line-through text-gray-400 opacity-60 cursor-default">
                  <Highlight text={item.name} query={searchQuery} />
                </span>
              )}

            </div>

            {/* Автор записи: показывается только если включён переключатель */}
            {!isPending && showAuthors && item.addedBy && (
              <span className="text-gray-400 text-xs shrink-0">
                {item.addedBy.id === currentUserId
                  ? t("you")
                  : item.addedBy.name || item.addedBy.email}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {!isPending && editingItemId === item.id ? (
              <>
                {/* Кнопка сохранения при редактировании */}
                <button
                  type="button"
                  aria-label="Сохранить"
                  onMouseDown={() => { skipItemBlurRef.current = true; }}
                  onClick={() => void handleConfirmItemRename(item)}
                  className="hidden sm:inline-flex items-center justify-center w-6 h-6 rounded text-sm text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-zinc-700 transition"
                >
                  ✓
                </button>
                {/* Кнопка отмены при редактировании */}
                <button
                  type="button"
                  aria-label="Отменить"
                  onMouseDown={() => { skipItemBlurRef.current = true; }}
                  onClick={() => setEditingItemId(null)}
                  className="inline-flex items-center justify-center w-6 h-6 rounded text-sm text-gray-400 dark:text-zinc-500 hover:bg-gray-100 dark:hover:bg-zinc-700 hover:text-gray-600 dark:hover:text-zinc-300 transition"
                >
                  ✗
                </button>
              </>
            ) : (
              <>
                {/* Заполненная заметка остаётся доступна отдельной кнопкой. */}
                {item.note && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      setEditingItemId(null);
                      setOpenItemActionsId(null);
                      setOpenNoteItemId((current) =>
                        current === item.id ? null : item.id,
                      );
                    }}
                    aria-label={notesT("itemNote")}
                    title={notesT("itemNote")}
                    aria-expanded={openNoteItemId === item.id}
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-indigo-500 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                  >
                    <NoteIcon filled />
                  </button>
                )}
                {/* Меню действий записи: безопасное место для удаления и будущих команд. */}
                <div
                  ref={openItemActionsId === item.id ? itemActionsMenuRef : undefined}
                  className="relative"
                >
                  <button
                    ref={openItemActionsId === item.id ? itemActionsButtonRef : undefined}
                    type="button"
                    disabled={isPending}
                    title={isPending ? t("saving") : undefined}
                    onClick={() => {
                      setEditingItemId(null);
                      setOpenNoteItemId(null);
                      setOpenItemActionsId((current) =>
                        current === item.id ? null : item.id,
                      );
                    }}
                    aria-label={t("ariaItemActions", { name: item.name })}
                    aria-haspopup="menu"
                    aria-expanded={openItemActionsId === item.id}
                    aria-controls={`item-actions-${item.id}`}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${
                      openItemActionsId === item.id
                        ? "bg-gray-100 text-gray-900 dark:bg-zinc-800 dark:text-white"
                        : "text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    } disabled:cursor-not-allowed disabled:text-gray-300 dark:disabled:text-zinc-700`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="currentColor"
                      aria-hidden
                    >
                      <circle cx="12" cy="5" r="1.75" />
                      <circle cx="12" cy="12" r="1.75" />
                      <circle cx="12" cy="19" r="1.75" />
                    </svg>
                  </button>

                  {openItemActionsId === item.id && (
                    <div
                      id={`item-actions-${item.id}`}
                      role="menu"
                      className="absolute right-0 top-full z-30 mt-1 min-w-48 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-black/60"
                    >
                      {/* Перемещение доступно только у невыполненных
                          записей: выполненные нумерации не имеют и
                          живут отдельным блоком внизу. */}
                      {canReorderItems && !item.isCompleted && (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={!canMoveUp}
                            onClick={() => {
                              setOpenItemActionsId(null);
                              handleMoveItem(item, "up");
                            }}
                            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-700"
                          >
                            <MoveUpIcon />
                            {t("moveUp")}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={!canMoveDown}
                            onClick={() => {
                              setOpenItemActionsId(null);
                              handleMoveItem(item, "down");
                            }}
                            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-700"
                          >
                            <MoveDownIcon />
                            {t("moveDown")}
                          </button>

                          <div
                            role="separator"
                            className="my-1 h-px bg-gray-100 dark:bg-zinc-700"
                          />
                        </>
                      )}

                      {!item.note && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenItemActionsId(null);
                            setOpenNoteItemId(item.id);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                        >
                          <NoteIcon size={17} />
                          {notesT("addItemNote")}
                        </button>
                      )}

                      {/* Удаление заметки записи — без удаления самой записи,
                          поэтому пункт нейтральный, а не красный. */}
                      {item.note && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpenItemActionsId(null);
                            setNoteToDeleteItemId(item.id);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-zinc-200 dark:hover:bg-zinc-700"
                        >
                          <NoteRemoveIcon />
                          {notesT("deleteNote")}
                        </button>
                      )}

                      <div
                        role="separator"
                        className="my-1 h-px bg-gray-100 dark:bg-zinc-700"
                      />

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenItemActionsId(null);
                          setItemToDelete(item);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        <TrashIcon />
                        {t("deleteItemAction")}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          </div>

          {noteMatchesSearch && item.note && openNoteItemId !== item.id && (
            <p className={`${rowIndent} mt-1.5 rounded-md bg-white/70 px-2 py-1.5 text-xs leading-relaxed text-gray-500 dark:bg-zinc-900/50 dark:text-zinc-400`}>
              <Highlight text={getNoteExcerpt(item.note, searchQuery)} query={searchQuery} />
            </p>
          )}

          {!isPending && openNoteItemId === item.id && (
            <div className={rowIndent}>
              <NotePanel
                note={item.note}
                version={item.noteVersion}
                compact
                searchQuery={searchQuery}
                onSave={(draft, expectedVersion) =>
                  api.updateItemNote(item.id, draft, expectedVersion)
                }
                onClose={() => setOpenNoteItemId(null)}
              />
            </div>
          )}
      </>
    );
  };

  return (
    <>
      <div>
        {/* -----------------------------------------------------------------------
          Список записей.

          Когда порядок менять можно, невыполненные записи живут внутри
          Reorder.Group, а выполненные идут следом обычными li: перетаскивать
          их некуда, нумерации у них нет. Плоский ul остаётся для случаев,
          когда перетаскивание неуместно — активный поиск или одна запись.
      ----------------------------------------------------------------------- */}
        {canReorderItems ? (
          <Reorder.Group
            as="ul"
            axis="y"
            values={draggableItems}
            onReorder={setDragOrder}
            className="mb-4 divide-y divide-gray-100 dark:divide-zinc-800"
          >
            {draggableItems.map((item) => (
              <DraggableItemRow
                key={item.id}
                item={item}
                className={rowClassName(item)}
                onDragStart={() => handleDragStart(item)}
                onDragEnd={() => handleDragEnd(item)}
              >
                {(dragControls) => renderItemRow(item, dragControls)}
              </DraggableItemRow>
            ))}

            {completedVisibleItems.map((item) => (
              <li key={item.id} className={rowClassName(item)}>
                {renderItemRow(item, null)}
              </li>
            ))}
          </Reorder.Group>
        ) : (
          <ul className="mb-4 divide-y divide-gray-100 dark:divide-zinc-800">
            {visibleItems.map((item) => (
              <li key={item.id} className={rowClassName(item)}>
                {renderItemRow(item, null)}
              </li>
            ))}

            {/* Сообщение о пустом списке */}
            {visibleItems.length === 0 && (
              <li className="text-gray-400 text-sm text-center">{t("empty")}</li>
            )}
          </ul>
        )}

        {/* -----------------------------------------------------------------------
          Форма добавления новой записи
      ----------------------------------------------------------------------- */}
        <form
          onSubmit={async (event) => {
            event.preventDefault();

            const trimmedName = newItemName.trim();
            if (!trimmedName || isAddingItem) return;

            // 1. Генерируем временный ID для оптимистичного обновления
            const tempId = `temp-${Date.now()}`;

            // 2. Мгновенно добавляем запись на экран
            startTransition(() => {
              setOptimisticItems({
                action: "add",
                itemId: tempId,
                itemName: trimmedName,
                addedBy: {
                  id: currentUserId,
                  name: currentUserName,
                  email: currentUserEmail,
                },
              });
            });

            // 3. Сразу очищаем поле ввода (пользователь может начинать следующий)
            setNewItemName("");
            setIsAddingItem(true);

            // 4. Сохраняем запись в фоне (БД или localStorage — решает адаптер)
            const result = await api.addItem(listId, trimmedName);

            setIsAddingItem(false);

            // 5. При ошибке — откат: удаляем временную запись и возвращаем введённое название
            if (result && !result.success) {
              startTransition(() => {
                setOptimisticItems({ action: "delete", itemId: tempId });
              });
              setNewItemName(trimmedName);
              toast.error(
                result.error === "tooLong"
                  ? t("errors.tooLong")
                  : t("errors.addFailed"),
              );
            }
          }}
          className="flex gap-2"
        >
          <input
            name="itemName"
            autoComplete="off"
            placeholder={t("placeholder")}
            className="border dark:border-zinc-700 p-2 rounded-lg w-full text-sm bg-gray-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 focus:ring-1 ring-gray-800 dark:ring-zinc-500 outline-none transition"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            maxLength={200}
            required
          />
          <button
            type="submit"
            aria-label={t("placeholder")}
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-gray-800 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-gray-700 dark:hover:bg-white active:scale-95 transition-all duration-150 shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </form>
      </div>

      {/* -----------------------------------------------------------------------
          Модальное окно подтверждения удаления записи.
          Клик на фон (overlay) — закрыть без удаления.
          Клик внутри модала — не закрывает (stopPropagation).
      ----------------------------------------------------------------------- */}
      {itemToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4"
          onClick={() => setItemToDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white dark:bg-zinc-800 dark:border dark:border-zinc-700 p-5 shadow-lg dark:shadow-2xl dark:shadow-black/70"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">
              {t("deleteModal.title")}
            </h3>
            <p className="text-sm text-gray-600 dark:text-zinc-400 mb-5">
              {t("deleteModal.body", { name: itemToDelete.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800"
              >
                {t("deleteModal.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteItem}
                className="px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700"
              >
                {t("deleteModal.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Подтверждение удаления заметки записи: вызывается из меню действий. */}
      {noteDeleteItem && (
        <DeleteNoteModal
          version={noteDeleteItem.noteVersion}
          onSave={(draft, expectedVersion) =>
            api.updateItemNote(noteDeleteItem.id, draft, expectedVersion)
          }
          onDeleted={() => {
            setNoteToDeleteItemId(null);
            setOpenNoteItemId((current) =>
              current === noteDeleteItem.id ? null : current,
            );
          }}
          onCancel={() => setNoteToDeleteItemId(null)}
        />
      )}
    </>
  );
}
