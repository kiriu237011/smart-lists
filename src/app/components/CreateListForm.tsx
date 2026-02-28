/**
 * @file CreateListForm.tsx
 * @description Форма для создания нового списка покупок.
 *
 * Client Component (`"use client"`): управляет локальным состоянием input-поля
 * и индикатором загрузки. Не обращается к БД напрямую — делегирует создание
 * через callback `onCreateList`, который передаётся из `ListsContainer`.
 *
 * Такое разделение позволяет `ListsContainer` применять оптимистичное обновление
 * (список появляется мгновенно) ещё до ответа сервера.
 *
 * Поведение при ошибке:
 *   - Если `onCreateList` вернул `{ success: false }`, введённое название
 *     возвращается обратно в поле ввода, чтобы пользователь мог попробовать снова.
 */

"use client";

import { useState } from "react";

/** Пропсы компонента `CreateListForm`. */
type CreateListFormProps = {
  /**
   * Асинхронный колбэк, вызываемый при сабмите формы.
   * Реализован в `ListsContainer` и содержит логику оптимистичного обновления.
   *
   * @param title - Нормализованное (trimmed) название нового списка.
   * @returns Объект `{ success: boolean }`.
   */
  onCreateList: (title: string) => Promise<{ success: boolean }>;
};

/**
 * Форма создания списка покупок.
 *
 * @param onCreateList - Колбэк обработки создания (из `ListsContainer`).
 */
export default function CreateListForm({ onCreateList }: CreateListFormProps) {
  /** Текущее значение поля ввода названия. */
  const [title, setTitle] = useState("");

  /** Флаг ожидания ответа сервера. Блокирует повторные отправки. */
  const [isCreating, setIsCreating] = useState(false);

  /**
   * Обработчик отправки формы.
   *
   * 1. Предотвращает стандартное поведение формы (перезагрузку страницы).
   * 2. Нормализует название (убирает пробелы по краям).
   * 3. Блокирует повторную отправку пока идёт запрос.
   * 4. Вызывает `onCreateList` и обрабатывает результат.
   *
   * @param event - Событие сабмита формы.
   */
  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedTitle = title.trim();

    // Защита от пустого названия или двойного сабмита
    if (!normalizedTitle || isCreating) {
      return;
    }

    setIsCreating(true);
    setTitle(""); // Оптимистично очищаем поле, не дожидаясь ответа

    const result = await onCreateList(normalizedTitle);

    // Если создание не удалось — возвращаем название в поле
    if (!result.success) {
      setTitle(normalizedTitle);
    }

    setIsCreating(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
      {/* Поле ввода названия списка */}
      <input
        name="title"
        placeholder="Например: Продукты на неделю..."
        className="w-full min-w-0 flex-1 border p-3 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 ring-blue-500 outline-none transition"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        disabled={isCreating}
        required
      />

      {/* Кнопка создания: показывает спиннер во время ожидания */}
      <button
        type="submit"
        disabled={isCreating}
        className="w-full shrink-0 bg-blue-600 text-white px-6 py-2 rounded-lg font-medium transition sm:w-auto disabled:cursor-not-allowed disabled:bg-blue-700 hover:bg-blue-700"
      >
        {isCreating ? (
          <span className="inline-flex items-center gap-2">
            {/* Анимированный спиннер */}
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/80 border-t-transparent"
            />
            Создаём...
          </span>
        ) : (
          "Создать"
        )}
      </button>
    </form>
  );
}
