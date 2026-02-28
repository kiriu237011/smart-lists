/**
 * @file ShoppingList.tsx
 * @description Компонент отдельного списка покупок с поддержкой оптимистичных обновлений.
 *
 * Client Component (`"use client"`).
 *
 * Отображает список товаров и форму добавления нового товара.
 * Все три операции (добавление, удаление, переключение статуса) реализованы
 * с оптимистичным обновлением: UI меняется МГНОВЕННО, а запрос к серверу
 * выполняется в фоне.
 *
 * Паттерн "оптимистичный ID":
 *   При добавлении товар получает временный ID `temp-<timestamp>`.
 *   Пока товар имеет такой ID, он визуально помечается как "сохраняется":
 *     - Полупрозрачность (opacity-60)
 *     - Анимированный спиннер вместо чекбокса
 *     - Надпись "Сохраняется..." рядом с названием
 *   После ответа сервера `revalidatePath("/")` заменяет временный товар реальным.
 *
 * Откат при ошибке (только для addItem):
 *   Если сервер вернул ошибку — временный товар удаляется из UI,
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
} from "react";
import { addItem, deleteItem, toggleItem, renameItem } from "@/app/actions";

// ---------------------------------------------------------------------------
// Типы данных
// ---------------------------------------------------------------------------

/** Один товар в списке покупок. */
type Item = {
  id: string;
  name: string;
  isCompleted: boolean;
};

/** Пропсы компонента `ShoppingList`. */
type ShoppingListProps = {
  /** Начальные данные о товарах (загружаются с сервера). */
  items: Item[];
  /** ID списка покупок, которому принадлежат эти товары. */
  listId: string;
};

// ---------------------------------------------------------------------------
// Компонент
// ---------------------------------------------------------------------------

/**
 * Компонент списка товаров с оптимистичными обновлениями.
 *
 * @param items - Начальный массив товаров (с сервера).
 * @param listId - ID списка для привязки новых товаров.
 */
export default function ShoppingList({ items, listId }: ShoppingListProps) {
  /**
   * Оптимистичный массив товаров.
   *
   * `useOptimistic` принимает:
   *   - начальное состояние (`items` с сервера)
   *   - reducer-функцию, описывающую как изменить состояние локально
   *
   * Поддерживаемые действия:
   *   - `toggle`  — инвертирует `isCompleted` у товара с заданным `itemId`.
   *   - `delete`  — удаляет товар с заданным `itemId` из массива.
   *   - `add`     — добавляет временный товар с `itemId` как временным ID.
   */
  const [optimisticItems, setOptimisticItems] = useOptimistic(
    items,
    (
      state,
      {
        action,
        itemId,
        itemName,
      }: {
        action: "toggle" | "delete" | "add" | "rename";
        itemId: string;
        itemName?: string;
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
              isCompleted: false,
            },
          ];
        case "rename":
          return state.map((item) =>
            item.id === itemId
              ? { ...item, name: itemName || item.name }
              : item,
          );
        default:
          return state;
      }
    },
  );

  /** Текущее значение поля ввода нового товара. */
  const [newItemName, setNewItemName] = useState("");

  /** Флаг ожидания ответа сервера при добавлении товара. */
  const [isAddingItem, setIsAddingItem] = useState(false);

  /**
   * Товар, ожидающий подтверждения удаления.
   * `null` означает, что модальное окно закрыто.
   */
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);

  /** Флаг ожидания ответа сервера при удалении товара. Блокирует повторные запросы. */
  const [isDeletingItem, setIsDeletingItem] = useState(false);

  /** ID товара, название которого сейчас редактируется. */
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  /** Текущее значение поля ввода при редактировании товара. */
  const [editItemName, setEditItemName] = useState("");

  /** Защита от двойного вызова rename (Enter → blur). */
  const processingItemRenameRef = useRef(false);

  /** Сигнал для игнорирования blur при нажатии Escape. */
  const skipItemBlurRef = useRef(false);

  /**
   * Обработчик подтверждения удаления товара.
   *
   * Вызывается из модального окна или по нажатию Enter.
   * Выполняет оптимистичное удаление.
   */
  const handleConfirmDeleteItem = useCallback(async () => {
    if (!itemToDelete) return;

    const item = itemToDelete;
    setIsDeletingItem(true);
    setItemToDelete(null); // Закрываем модал немедленно

    // Оптимистично убираем товар из UI
    startTransition(() => {
      setOptimisticItems({ action: "delete", itemId: item.id });
    });

    const formData = new FormData();
    formData.append("itemId", item.id);
    await deleteItem(formData);

    setIsDeletingItem(false);
  }, [itemToDelete, setOptimisticItems]);

  /**
   * Эффект: подписка на клавиатурные события при открытом модале удаления товара.
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

  /**
   * Подтверждает переименование товара.
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

      const formData = new FormData();
      formData.append("itemId", item.id);
      formData.append("itemName", trimmedName);
      const result = await renameItem(formData);

      if (result && !result.success) {
        startTransition(() => {
          setOptimisticItems({
            action: "rename",
            itemId: item.id,
            itemName: item.name,
          });
        });
        alert(result.error || "Не удалось переименовать товар");
      }
    } finally {
      processingItemRenameRef.current = false;
    }
  };

  return (
    <>
      <div>
        {/* -----------------------------------------------------------------------
          Список товаров
      ----------------------------------------------------------------------- */}
        <ul className="mb-4 space-y-2">
          {optimisticItems.map((item) => {
            /**
             * Товар считается "в ожидании" (pending), если его ID начинается с "temp-".
             * В этом состоянии интерактивные элементы заблокированы.
             */
            const isPending = item.id.startsWith("temp-");

            return (
              <li
                key={item.id}
                className={`flex items-center justify-between p-2 rounded transition-opacity ${
                  isPending ? "bg-gray-100 opacity-60" : "bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {/* Кнопка переключения статуса (чекбокс) */}
                  <form
                    action={async () => {
                      // 1. Мгновенно меняем UI
                      setOptimisticItems({ action: "toggle", itemId: item.id });

                      // 2. Отправляем данные на сервер
                      const formData = new FormData();
                      formData.append("itemId", item.id);
                      formData.append(
                        "isCompleted",
                        item.isCompleted.toString(),
                      );

                      await toggleItem(formData);
                    }}
                  >
                    <button
                      type="submit"
                      disabled={isPending}
                      title={isPending ? "Сохраняется..." : undefined}
                      className={`w-5 h-5 border rounded flex items-center justify-center transition-colors ${
                        isPending
                          ? "border-gray-300 cursor-not-allowed"
                          : item.isCompleted
                            ? "bg-white border-blue-500"
                            : "bg-white border-gray-300"
                      }`}
                    >
                      {isPending ? (
                        // Спиннер для ожидающего товара
                        <span className="block w-2.5 h-2.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        // Галочка для купленного товара
                        item.isCompleted && (
                          <span className="text-blue-500 text-xs">✔︎</span>
                        )
                      )}
                    </button>
                  </form>

                  {/* Название товара (или поле редактирования) */}
                  {!isPending && editingItemId === item.id ? (
                    <input
                      autoFocus
                      value={editItemName}
                      maxLength={100}
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
                      className="text-sm border p-1 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 ring-blue-500 outline-none transition w-full min-w-0"
                    />
                  ) : (
                    <span
                      className={
                        isPending
                          ? "text-gray-400 italic text-sm"
                          : item.isCompleted
                            ? "line-through text-gray-400"
                            : ""
                      }
                    >
                      {item.name}
                    </span>
                  )}

                  {/* Надпись "Сохраняется..." для ожидающего товара */}
                  {isPending && (
                    <span className="text-gray-400 text-xs">
                      Сохраняется...
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {/* Кнопка переименования товара */}
                  {!isPending && editingItemId !== item.id && (
                    <button
                      type="button"
                      aria-label={`Переименовать товар ${item.name}`}
                      onClick={() => {
                        setEditingItemId(item.id);
                        setEditItemName(item.name);
                      }}
                      className="text-gray-400 hover:text-blue-500 text-sm px-1 py-1 leading-none transition-colors"
                    >
                      ✎
                    </button>
                  )}

                  {/* Кнопка удаления товара */}
                  <button
                    type="button"
                    disabled={isPending}
                    title={isPending ? "Сохраняется..." : undefined}
                    onClick={() => setItemToDelete(item)}
                    aria-label={`Удалить товар ${item.name}`}
                    className={`text-xs font-bold px-2 py-1 transition-colors ${
                      isPending
                        ? "text-gray-300 cursor-not-allowed"
                        : "text-red-500 hover:text-red-700"
                    }`}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}

          {/* Сообщение о пустом списке */}
          {optimisticItems.length === 0 && (
            <li className="text-gray-400 text-sm text-center">Список пуст</li>
          )}
        </ul>

        {/* -----------------------------------------------------------------------
          Форма добавления нового товара
      ----------------------------------------------------------------------- */}
        <form
          onSubmit={async (event) => {
            event.preventDefault();

            const trimmedName = newItemName.trim();
            if (!trimmedName || isAddingItem) return;

            // 1. Генерируем временный ID для оптимистичного обновления
            const tempId = `temp-${Date.now()}`;

            // 2. Мгновенно добавляем товар на экран
            startTransition(() => {
              setOptimisticItems({
                action: "add",
                itemId: tempId,
                itemName: trimmedName,
              });
            });

            // 3. Сразу очищаем поле ввода (пользователь может начинать следующий)
            setNewItemName("");
            setIsAddingItem(true);

            // 4. Отправляем данные на сервер в фоне
            const formData = new FormData();
            formData.append("listId", listId);
            formData.append("itemName", trimmedName);
            const result = await addItem(formData);

            setIsAddingItem(false);

            // 5. При ошибке — откат: удаляем временный товар и возвращаем введённое название
            if (result && !result.success) {
              startTransition(() => {
                setOptimisticItems({ action: "delete", itemId: tempId });
              });
              setNewItemName(trimmedName);
              alert(result.error || "Не удалось добавить товар");
            }
          }}
          className="flex gap-2"
        >
          <input
            name="itemName"
            placeholder="Что купить?"
            className="border p-2 rounded w-full text-sm"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            required
          />
          <button
            type="submit"
            className="bg-black text-white px-4 py-2 rounded text-sm hover:bg-gray-800"
          >
            +
          </button>
        </form>
      </div>

      {/* -----------------------------------------------------------------------
          Модальное окно подтверждения удаления товара.
          Клик на фон (overlay) — закрыть без удаления.
          Клик внутри модала — не закрывает (stopPropagation).
      ----------------------------------------------------------------------- */}
      {itemToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setItemToDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">Удалить товар?</h3>
            <p className="text-sm text-gray-600 mb-5">
              Вы действительно хотите удалить товар «{itemToDelete.name}»?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteItem}
                className="px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
