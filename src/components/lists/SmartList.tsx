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
} from "react";
import { addItem, deleteItem, toggleItem, renameItem } from "@/app/actions";
import toast from "react-hot-toast";
import { useTranslations } from "next-intl";
import Highlight from "@/components/ui/Highlight";

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
  /** Активный поисковый запрос для подсветки совпадений (пустая строка = нет поиска). */
  searchQuery?: string;
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
export default function SmartList({
  items,
  listId,
  currentUserId,
  currentUserName,
  currentUserEmail,
  showAuthors,
  searchQuery = "",
}: SmartListProps) {
  const t = useTranslations("SmartList");

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
          {[...optimisticItems]
            .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted))
            .map((item) => {
              /**
               * Запись считается "в ожидании" (pending), если её ID начинается с "temp-".
               * В этом состоянии интерактивные элементы заблокированы.
               */
              const isPending = item.id.startsWith("temp-");

              return (
                <li
                  key={item.id}
                  className={`flex items-center justify-between gap-2 p-2 rounded transition-all duration-200 ${
                    isPending
                      ? "bg-gray-50 dark:bg-zinc-800"
                      : item.isCompleted
                        ? "bg-gray-100 dark:bg-zinc-800/50"
                        : "bg-gray-50 dark:bg-zinc-800"
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Кнопка переключения статуса (чекбокс): invisible при редактировании */}
                    <form
                      className={editingItemId === item.id ? "invisible" : ""}
                      action={async () => {
                        // 1. Мгновенно меняем UI
                        setOptimisticItems({
                          action: "toggle",
                          itemId: item.id,
                        });

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
                          <span className="block w-2.5 h-2.5 border-2 border-gray-400 dark:border-zinc-500 border-t-transparent rounded-full animate-spin" />
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
                              setEditingItemId(item.id);
                              setEditItemName(item.name);
                            }
                          : undefined
                      }
                    >
                      {!isPending && editingItemId === item.id ? (
                        <textarea
                          autoFocus
                          value={editItemName}
                          maxLength={100}
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
                          className="hidden sm:inline-flex text-green-600 hover:text-white hover:bg-green-600 text-sm px-1 py-1 leading-none rounded transition"
                        >
                          ✓
                        </button>
                        {/* Кнопка отмены при редактировании */}
                        <button
                          type="button"
                          aria-label="Отменить"
                          onMouseDown={() => { skipItemBlurRef.current = true; }}
                          onClick={() => setEditingItemId(null)}
                          className="text-gray-400 hover:text-white hover:bg-gray-500 dark:hover:bg-zinc-600 text-sm px-1 py-1 leading-none rounded transition"
                        >
                          ✗
                        </button>
                      </>
                    ) : (
                      <>
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
                      </>
                    )}
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
            className="border dark:border-zinc-700 p-2 rounded-lg w-full text-sm bg-gray-50 dark:bg-zinc-900 focus:bg-white dark:focus:bg-zinc-950 focus:ring-1 ring-gray-800 dark:ring-zinc-500 outline-none transition"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            required
          />
          <button
            type="submit"
            className="bg-gray-800 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-2 rounded text-sm hover:bg-gray-900 dark:hover:bg-zinc-200"
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
            className="w-full max-w-md rounded-xl bg-white dark:bg-zinc-900 p-5 shadow-lg"
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
    </>
  );
}
