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

import { useOptimistic, useRef } from "react";
import { addItem, deleteItem, toggleItem } from "@/app/actions";

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
        action: "toggle" | "delete" | "add";
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
              id: itemId, // Временный ID вида "temp-<timestamp>"
              name: itemName || "",
              isCompleted: false,
            },
          ];
        default:
          return state;
      }
    },
  );

  /**
   * Ref на элемент `<form>` добавления товара.
   * Используется для сброса формы (`formRef.current?.reset()`) после отправки.
   */
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * Ref на элемент `<input>` с названием товара.
   * Используется для возврата значения при откате (если сервер вернул ошибку).
   */
  const inputRef = useRef<HTMLInputElement>(null);

  return (
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
              <div className="flex items-center gap-2">
                {/* Кнопка переключения статуса (чекбокс) */}
                <form
                  action={async () => {
                    // 1. Мгновенно меняем UI
                    setOptimisticItems({ action: "toggle", itemId: item.id });

                    // 2. Отправляем данные на сервер
                    const formData = new FormData();
                    formData.append("itemId", item.id);
                    formData.append("isCompleted", item.isCompleted.toString());

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
                        <span className="text-blue-500 text-xs">✔</span>
                      )
                    )}
                  </button>
                </form>

                {/* Название товара */}
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

                {/* Надпись "Сохраняется..." для ожидающего товара */}
                {isPending && (
                  <span className="text-gray-400 text-xs">Сохраняется...</span>
                )}
              </div>

              {/* Кнопка удаления товара */}
              <form
                action={async () => {
                  // 1. Мгновенно убираем товар из UI
                  setOptimisticItems({ action: "delete", itemId: item.id });

                  // 2. Удаляем из БД в фоне
                  const formData = new FormData();
                  formData.append("itemId", item.id);
                  await deleteItem(formData);
                }}
              >
                <button
                  type="submit"
                  disabled={isPending}
                  title={isPending ? "Сохраняется..." : undefined}
                  className={`text-xs font-bold px-2 py-1 transition-colors ${
                    isPending
                      ? "text-gray-300 cursor-not-allowed"
                      : "text-red-500 hover:text-red-700"
                  }`}
                >
                  ✕
                </button>
              </form>
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
        ref={formRef}
        action={async (formData) => {
          const itemName = formData.get("itemName") as string;

          // 1. Генерируем временный ID для оптимистичного обновления
          const tempId = `temp-${Date.now()}`;

          // 2. Мгновенно добавляем товар на экран
          setOptimisticItems({ action: "add", itemId: tempId, itemName });

          // 3. Сбрасываем форму (очищаем поле ввода)
          formRef.current?.reset();

          // 4. Отправляем данные на сервер в фоне
          const result = await addItem(formData);

          // 5. При ошибке — откат: удаляем временный товар и возвращаем введённое название
          if (result && !result.success) {
            setOptimisticItems({ action: "delete", itemId: tempId });

            if (inputRef.current) {
              inputRef.current.value = itemName;
            }

            alert(result.error || "Не удалось добавить товар");
          }
        }}
        className="flex gap-2"
      >
        {/* Скрытое поле: ID списка для привязки нового товара */}
        <input type="hidden" name="listId" value={listId} />
        <input
          ref={inputRef}
          name="itemName"
          placeholder="Что купить?"
          className="border p-2 rounded w-full text-sm"
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
  );
}
