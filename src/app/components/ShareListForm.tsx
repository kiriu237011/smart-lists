/**
 * @file ShareListForm.tsx
 * @description Форма для предоставления совместного доступа к списку покупок.
 *
 * Client Component (`"use client"`).
 *
 * Позволяет владельцу списка пригласить другого пользователя по email.
 * Приглашённый пользователь должен быть уже зарегистрирован в системе
 * (т.е. хотя бы раз войти через Google).
 *
 * Оптимистичное обновление (`useOptimistic`):
 *   - Приглашённый пользователь мгновенно появляется в списке доступов.
 *   - Если Server Action `shareList` вернул ошибку — пользователь удаляется
 *     из списка, а email возвращается в поле ввода.
 *
 * Архитектура состояния:
 *   - `optimisticSharedWith` — список отображаемых пользователей с доступом.
 *     Включает как реальных (из БД), так и "оптимистичных" (с временным ID).
 *   - `email` — текущее значение поля ввода.
 */

"use client";

import { startTransition, useOptimistic, useState } from "react";
import { shareList } from "@/app/actions";

/** Пользователь, имеющий доступ к списку. */
type SharedUser = {
  id: string;
  name: string | null;
  email: string | null;
};

/** Пропсы компонента `ShareListForm`. */
type ShareListFormProps = {
  /** ID списка, которым делятся. */
  listId: string;
  /** Начальный список пользователей с доступом (загружается с сервера). */
  sharedWith: SharedUser[];
};

/**
 * Форма управления совместным доступом к списку.
 *
 * @param listId - ID списка покупок.
 * @param sharedWith - Список уже приглашённых пользователей.
 */
export default function ShareListForm({
  listId,
  sharedWith,
}: ShareListFormProps) {
  /**
   * Оптимистичный список пользователей с доступом.
   *
   * Reducer поддерживает два действия:
   *   - `add`: добавляет пользователя (с проверкой на дубликат по email).
   *   - `remove`: удаляет пользователя по id (используется для отката при ошибке).
   */
  const [optimisticSharedWith, setOptimisticSharedWith] = useOptimistic(
    sharedWith,
    (
      state,
      { action, user }: { action: "add" | "remove"; user: SharedUser },
    ) => {
      switch (action) {
        case "add":
          // Предотвращаем дублирование (например, при повторной отправке)
          if (state.some((u) => u.email === user.email)) {
            return state;
          }
          return [...state, user];
        case "remove":
          // Удаляем по id — это позволяет удалить именно временную запись при откате
          return state.filter((u) => u.id !== user.id);
        default:
          return state;
      }
    },
  );

  /** Текущее значение поля email. */
  const [email, setEmail] = useState("");

  /**
   * Обработчик отправки формы приглашения.
   *
   * Порядок действий:
   *   1. Нормализуем email (trim).
   *   2. Создаём временного пользователя с `tempId`.
   *   3. Оптимистично добавляем его в список.
   *   4. Очищаем поле ввода.
   *   5. Вызываем Server Action `shareList`.
   *   6. При ошибке — откатываем оптимистичное изменение и возвращаем email.
   *
   * @param event - Событие сабмита формы.
   */
  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const rawEmail = (formData.get("email") as string) ?? "";
    const normalizedEmail = rawEmail.trim();

    if (!normalizedEmail) {
      return;
    }

    // Временный пользователь для оптимистичного отображения
    const tempId = `temp-${Date.now()}`;
    const tempUser = {
      id: tempId,
      email: normalizedEmail,
      name: null,
    };

    // 1. Мгновенно добавляем пользователя в список доступов
    startTransition(() => {
      setOptimisticSharedWith({ action: "add", user: tempUser });
    });

    // 2. Очищаем поле ввода
    setEmail("");

    // 3. Отправляем запрос на сервер
    formData.set("email", normalizedEmail);
    const result = await shareList(formData);

    // 4. Откат при ошибке
    if (result && !result.success) {
      startTransition(() => {
        setOptimisticSharedWith({ action: "remove", user: tempUser });
      });
      setEmail(normalizedEmail);
      alert(result.error || "Не удалось предоставить доступ");
    }
    // При успехе: revalidatePath в Server Action обновит реальные данные из БД,
    // и Next.js заменит временного пользователя на настоящего автоматически.
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <h4 className="text-xs font-semibold text-gray-500 mb-2 uppercase">
        Поделиться списком:
      </h4>

      {/* Бейджи пользователей, уже имеющих доступ */}
      {optimisticSharedWith.length > 0 && (
        <div className="flex gap-1 mb-2 flex-wrap">
          {optimisticSharedWith.map((user) => (
            <span
              key={user.id}
              className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full"
            >
              {/* Показываем имя, если есть; иначе email */}
              {user.name || user.email}
            </span>
          ))}
        </div>
      )}

      {/* Форма приглашения по email */}
      <form onSubmit={handleSubmit} className="flex gap-2 mt-3">
        {/* Скрытое поле с ID списка — передаётся в Server Action */}
        <input type="hidden" name="listId" value={listId} />
        <input
          name="email"
          type="email"
          placeholder="Email друга..."
          className="border p-1 rounded text-xs flex-1"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <button
          type="submit"
          className="bg-blue-100 text-blue-600 px-3 py-1 rounded text-xs font-bold hover:bg-blue-200"
        >
          Пригласить
        </button>
      </form>
    </div>
  );
}
