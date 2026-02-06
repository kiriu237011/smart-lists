"use client"; // <--- ВАЖНО! Это делает компонент клиентским

import { useOptimistic, useRef } from "react";
import { addItem, deleteItem, toggleItem } from "@/app/actions";

// Типы данных (чтобы TypeScript не ругался)
type Item = {
  id: string;
  name: string;
  isCompleted: boolean;
};

type ShoppingListProps = {
  items: Item[]; // Начальные данные с сервера
  listId: string;
};

export default function ShoppingList({ items, listId }: ShoppingListProps) {
  // --- МАГИЯ useOptimistic ---
  // 1. optimisticItems: это то, что мы будем рисовать. Сначала оно равно items (с сервера).
  // 2. setOptimisticItems: функция, чтобы менять этот список мгновенно.
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
      // Это "Reducer". Он говорит: как изменить состояние локально?

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
          // Добавляем новый товар с временным ID
          return [
            ...state,
            {
              id: itemId, // Временный ID
              name: itemName || "",
              isCompleted: false,
            },
          ];
        default:
          return state;
      }
    },
  );

  // Ref для очистки input после отправки
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <ul className="mb-4 space-y-2">
        {optimisticItems.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between bg-gray-50 p-2 rounded"
          >
            <div className="flex items-center gap-2">
              {/* КНОПКА ГАЛОЧКИ */}
              <form
                action={async () => {
                  // 1. Мгновенно меняем цвет на экране
                  setOptimisticItems({ action: "toggle", itemId: item.id });

                  // 2. Создаем FormData вручную (так как мы не используем onSubmit формы)
                  const formData = new FormData();
                  formData.append("itemId", item.id);
                  formData.append("isCompleted", item.isCompleted.toString());

                  // 3. Отправляем на сервер в фоне
                  await toggleItem(formData);
                }}
              >
                <button
                  type="submit"
                  className={`w-5 h-5 border rounded flex items-center justify-center transition-colors ${
                    item.isCompleted
                      ? "bg-white border-blue-500"
                      : "bg-white border-gray-300"
                  }`}
                >
                  {item.isCompleted && (
                    <span className="text-blue-500 text-xs">✔</span>
                  )}
                </button>
              </form>

              <span
                className={item.isCompleted ? "line-through text-gray-400" : ""}
              >
                {item.name}
              </span>
            </div>

            {/* КНОПКА УДАЛЕНИЯ */}
            <form
              action={async () => {
                // 1. Мгновенно убираем со страницы
                setOptimisticItems({ action: "delete", itemId: item.id });

                // 2. Шлем запрос на сервер
                const formData = new FormData();
                formData.append("itemId", item.id);
                await deleteItem(formData);
              }}
            >
              <button
                type="submit"
                className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1"
              >
                ✕
              </button>
            </form>
          </li>
        ))}

        {optimisticItems.length === 0 && (
          <li className="text-gray-400 text-sm text-center">Список пуст</li>
        )}
      </ul>

      {/* ФОРМА ДОБАВЛЕНИЯ ТОВАРА */}
      <form
        ref={formRef}
        action={async (formData) => {
          const itemName = formData.get("itemName") as string;

          // 1. Генерируем временный ID для оптимистичного обновления
          const tempId = `temp-${Date.now()}`;

          // 2. Мгновенно добавляем товар на экран
          setOptimisticItems({ action: "add", itemId: tempId, itemName });

          // 3. Очищаем форму
          formRef.current?.reset();

          // 4. Отправляем на сервер в фоне
          const result = await addItem(formData);

          // 5. Если произошла ошибка - откатываем изменения
          if (result && !result.success) {
            // Удаляем временный товар
            setOptimisticItems({ action: "delete", itemId: tempId });

            // Возвращаем значение в input
            if (inputRef.current) {
              inputRef.current.value = itemName;
            }

            // Показываем ошибку
            alert(result.error || "Не удалось добавить товар");
          }
        }}
        className="flex gap-2"
      >
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
