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

import {
  startTransition,
  useCallback,
  useEffect,
  useOptimistic,
  useState,
} from "react";
import { removeSharedUser, shareList } from "@/app/actions";
import toast from "react-hot-toast";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("ShareListForm");

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

  /** Открыта ли форма приглашения. */
  const [isOpen, setIsOpen] = useState(false);

  /**
   * Пользователь, ожидающий подтверждения удаления доступа.
   * `null` означает, что модальное окно закрыто.
   */
  const [userToRemove, setUserToRemove] = useState<SharedUser | null>(null);

  /** Флаг ожидания ответа сервера при удалении пользователя. */
  const [isRemovingUser, setIsRemovingUser] = useState(false);

  /**
   * Обработчик подтверждения удаления пользователя из доступа.
   * Вызывается из модального окна или по нажатию Enter.
   */
  const handleConfirmRemoveUser = useCallback(async () => {
    if (!userToRemove) return;

    const user = userToRemove;
    setIsRemovingUser(true);
    setUserToRemove(null); // Закрываем модал немедленно

    // Оптимистично убираем пользователя из списка
    startTransition(() => {
      setOptimisticSharedWith({ action: "remove", user });
    });

    const formData = new FormData();
    formData.set("listId", listId);
    formData.set("userId", user.id);
    const result = await removeSharedUser(formData);

    // Откат при ошибке
    if (result && !result.success) {
      startTransition(() => {
        setOptimisticSharedWith({ action: "add", user });
      });
      toast.error(t("errors.removeFailed"));
    }

    setIsRemovingUser(false);
  }, [userToRemove, setOptimisticSharedWith, listId]);

  /**
   * Эффект: подписка на клавиатурные события при открытом модале удаления пользователя.
   *
   * - `Escape` — закрывает модал без удаления.
   * - `Enter`  — подтверждает удаление.
   */
  useEffect(() => {
    if (!userToRemove) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setUserToRemove(null);
        return;
      }
      if (event.key === "Enter" && !isRemovingUser) {
        event.preventDefault();
        void handleConfirmRemoveUser();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleConfirmRemoveUser, isRemovingUser, userToRemove]);

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
      toast.error(t("errors.shareFailed"));
    }
    // При успехе: revalidatePath в Server Action обновит реальные данные из БД,
    // и Next.js заменит временного пользователя на настоящего автоматически.
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all duration-200 mb-2 ${
          isOpen
            ? "bg-blue-50 border-blue-300 text-blue-700"
            : "bg-white border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50"
        }`}
      >
        {/* Иконка «поделиться» */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-3.5 h-3.5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        {t("share")}
        {/* Счётчик участников */}
        {optimisticSharedWith.length > 0 && (
          <span className="bg-blue-500 text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center leading-none shrink-0">
            {optimisticSharedWith.length}
          </span>
        )}
        {/* Шеврон */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Бейджи участников и форма приглашения — скрыты до нажатия на кнопку */}
      {isOpen && (
        <>
          {/* Бейджи пользователей, уже имеющих доступ */}
          {optimisticSharedWith.length > 0 && (
            <div className="flex gap-1 mb-2 flex-wrap">
              {optimisticSharedWith.map((user) => (
                <span
                  key={user.id}
                  className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full"
                >
                  {/* Показываем имя, если есть; иначе email */}
                  {user.name || user.email}

                  {/* Кнопка удаления пользователя из доступа */}
                  <button
                    type="button"
                    disabled={user.id.startsWith("temp-")}
                    title={
                      user.id.startsWith("temp-")
                        ? t("saving")
                        : t("ariaRemove", {
                            name: user.name ?? user.email ?? "",
                          })
                    }
                    className="ml-1 text-blue-500 hover:text-red-600 font-bold leading-none disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={() => setUserToRemove(user)}
                  >
                    ✕
                  </button>
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
              placeholder={t("placeholder")}
              className="border p-1 rounded text-xs flex-1"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <button
              type="submit"
              className="bg-blue-100 text-blue-600 px-3 py-1 rounded text-xs font-bold hover:bg-blue-200"
            >
              {t("invite")}
            </button>
          </form>
        </>
      )}

      {/* Модальное окно подтверждения удаления пользователя из доступа.
          Клик на фон (overlay) — закрыть без удаления.
          Клик внутри модала — не закрывает (stopPropagation). */}
      {userToRemove && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setUserToRemove(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">
              {t("removeModal.title")}
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              {t("removeModal.body", {
                name: userToRemove.name ?? userToRemove.email ?? "",
              })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUserToRemove(null)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-50"
              >
                {t("removeModal.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveUser}
                className="px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700"
              >
                {t("removeModal.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
