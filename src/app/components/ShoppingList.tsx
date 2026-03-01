/**
 * @file ShoppingList.tsx
 * @description Компонент отдельного списка покупок с поддержкой оптимистичных обновлений.
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
} from "react";
import { addItem, deleteItem, toggleItem, renameItem } from "@/app/actions";
import toast from "react-hot-toast";
import { useTranslations } from "next-intl";

// ---------------------------------------------------------------------------
// Типы данных
// ---------------------------------------------------------------------------

/** Одна запись в списке. */
type Item = {
  id: string;
  name: string;
  isCompleted: boolean;
  /** Пользователь, добавивший запись. null — для старых записей или temp-записей. */
  addedBy: { id: string; name: string | null; email: string } | null;
};

/** Пропсы компонента `ShoppingList`. */
type ShoppingListProps = {
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
};

// ---------------------------------------------------------------------------
// Компонент
// ---------------------------------------------------------------------------

/**
 * Компонент списка записей с оптимистичными обновлениями.
 *
 * @param items - Начальный массив записей (с сервера).
 * @param listId - ID списка для привязки новых записей.
 */
export default function ShoppingList({
  items,
  listId,
  currentUserId,
  currentUserName,
  currentUserEmail,
  showAuthors,
}: ShoppingListProps) {
  const t = useTranslations("ShoppingList");

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
      }: {
        action: "toggle" | "delete" | "add" | "rename";
        itemId: string;
        itemName?: string;
        addedBy?: Item["addedBy"];
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
              addedBy: addedBy ?? null,
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

    const formData = new FormData();
    formData.append("itemId", item.id);
    await deleteItem(formData);

    setIsDeletingItem(false);
  }, [itemToDelete, setOptimisticItems]);

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
        toast.error(t("errors.renameFailed"));
      }
    } finally {
      processingItemRenameRef.current = false;
    }
  };

  return (
    <>
      <div>
        {/* -----------------------------------------------------------------------
          Список записей
      ----------------------------------------------------------------------- */}
        <ul className="mb-4 space-y-2">
          {optimisticItems.map((item) => {
            /**
             * Запись считается "в ожидании" (pending), если её ID начинается с "temp-".
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
                      title={isPending ? t("saving") : undefined}
                      className={`w-5 h-5 border rounded flex items-center justify-center transition-colors ${
                        isPending
                          ? "border-gray-300 cursor-not-allowed"
                          : item.isCompleted
                            ? "bg-white border-blue-500"
                            : "bg-white border-gray-300"
                      }`}
                    >
                      {isPending ? (
                        // Спиннер для ожидающей записи
                        <span className="block w-2.5 h-2.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        // Галочка для выполненной записи
                        item.isCompleted && (
                          <span className="text-blue-500 text-xs">✔︎</span>
                        )
                      )}
                    </button>
                  </form>

                  {/* Название записи (или поле редактирования) + "Сохраняется..." */}
                  <div className="flex-1 min-w-0 flex items-center gap-1">
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

                    {/* Надпись "Сохраняется..." для ожидающей записи */}
                    {isPending && (
                      <span className="text-gray-400 text-xs">
                        {t("saving")}
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
                  {/* Кнопка переименования записи */}
                  {!isPending && editingItemId !== item.id && (
                    <button
                      type="button"
                      aria-label={t("ariaRename", { name: item.name })}
                      onClick={() => {
                        setEditingItemId(item.id);
                        setEditItemName(item.name);
                      }}
                      className="text-gray-400 hover:text-blue-500 text-sm px-1 py-1 leading-none transition-colors"
                    >
                      ✎
                    </button>
                  )}

                  {/* Кнопка удаления записи */}
                  <button
                    type="button"
                    disabled={isPending}
                    title={isPending ? t("saving") : undefined}
                    onClick={() => setItemToDelete(item)}
                    aria-label={t("ariaDelete", { name: item.name })}
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
            <li className="text-gray-400 text-sm text-center">{t("empty")}</li>
          )}
        </ul>

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

            // 4. Отправляем данные на сервер в фоне
            const formData = new FormData();
            formData.append("listId", listId);
            formData.append("itemName", trimmedName);
            const result = await addItem(formData);

            setIsAddingItem(false);

            // 5. При ошибке — откат: удаляем временную запись и возвращаем введённое название
            if (result && !result.success) {
              startTransition(() => {
                setOptimisticItems({ action: "delete", itemId: tempId });
              });
              setNewItemName(trimmedName);
              toast.error(t("errors.addFailed"));
            }
          }}
          className="flex gap-2"
        >
          <input
            name="itemName"
            placeholder={t("placeholder")}
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
          Модальное окно подтверждения удаления записи.
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
            <h3 className="text-lg font-semibold mb-2">
              {t("deleteModal.title")}
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              {t("deleteModal.body", { name: itemToDelete.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setItemToDelete(null)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-50"
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
    </>
  );
}
