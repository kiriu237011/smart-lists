/**
 * @file ListsContainer.tsx
 * @description Контейнер всех списков покупок пользователя.
 *
 * Client Component (`"use client"`).
 *
 * Это главный клиентский компонент приложения. Он:
 *   - Отображает все списки покупок (свои и расшаренные).
 *   - Содержит форму создания нового списка (`CreateListForm`).
 *   - Управляет оптимистичным состоянием списков через `useOptimistic`.
 *   - Реализует модальное окно подтверждения удаления.
 *
 * Оптимистичные обновления (`useOptimistic`):
 *   Список обновляется МГНОВЕННО на клиенте, не дожидаясь ответа сервера.
 *   Если Server Action вернул ошибку — изменение откатывается.
 *
 * Поддерживаемые действия reducer:
 *   - `add`     — добавить новый список (используется при создании).
 *   - `delete`  — удалить список по id.
 *   - `restore` — восстановить список на исходную позицию (откат удаления).
 *   - `replace` — заменить оптимистичный список реальным (после ответа сервера).
 *
 * Удаление через модальное окно:
 *   Клик на ✕ → модал → подтверждение/отмена (или Esc/Enter с клавиатуры).
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
import {
  createList,
  deleteList,
  renameList,
  leaveSharedList,
} from "@/app/actions";
import ShoppingList from "@/app/components/ShoppingList";
import ShareListForm from "@/app/components/ShareListForm";
import CreateListForm from "@/app/components/CreateListForm";

/** Пользователь, которому предоставлен доступ к списку. */
type SharedUser = {
  id: string;
  name: string | null;
  email: string | null;
};

/** Данные о владельце списка. */
type ListOwner = {
  name: string | null;
  email: string;
};

/** Товар внутри списка покупок. */
type Item = {
  id: string;
  name: string;
  isCompleted: boolean;
  addedBy: { id: string; name: string | null; email: string } | null;
};

/** Полные данные списка покупок (включая связанные сущности). */
type ShoppingListData = {
  id: string;
  title: string;
  ownerId: string;
  owner: ListOwner;
  items: Item[];
  sharedWith: SharedUser[];
};

/** Пропсы компонента `ListsContainer`. */
type ListsContainerProps = {
  /** Все списки, доступные пользователю (свои + расшаренные). Загружаются на сервере. */
  allLists: ShoppingListData[];
  /** ID текущего авторизованного пользователя. Используется для проверки прав. */
  currentUserId: string;
  /** Имя текущего пользователя (для оптимистичного placeholder нового списка). */
  currentUserName: string | null;
  /** Email текущего пользователя (аналогично). */
  currentUserEmail: string;
};

/**
 * Главный контейнер списков покупок.
 *
 * @param allLists - Начальные данные со всеми доступными списками.
 * @param currentUserId - ID авторизованного пользователя.
 * @param currentUserName - Имя авторизованного пользователя.
 * @param currentUserEmail - Email авторизованного пользователя.
 */
export default function ListsContainer({
  allLists,
  currentUserId,
  currentUserName,
  currentUserEmail,
}: ListsContainerProps) {
  /**
   * Список, ожидающий подтверждения удаления.
   * `null` означает, что модальное окно закрыто.
   */
  const [listToDelete, setListToDelete] = useState<ShoppingListData | null>(
    null,
  );

  /** Флаг ожидания ответа сервера при удалении. Блокирует повторные запросы. */
  const [isDeleting, setIsDeleting] = useState(false);

  /**
   * Расшаренный список, от которого пользователь хочет отписаться.
   * `null` означает, что модальное окно закрыто.
   */
  const [listToLeave, setListToLeave] = useState<ShoppingListData | null>(null);

  /** Флаг ожидания ответа сервера при выходе из расшаренного списка. */
  const [isLeaving, setIsLeaving] = useState(false);

  /** ID списка, чьё название сейчас редактируется. `null` — нет активного редактирования. */
  const [editingListId, setEditingListId] = useState<string | null>(null);

  /** Текущее значение поля ввода при редактировании названия. */
  const [editTitle, setEditTitle] = useState("");

  /**
   * Ref-флаг: предотвращает двойной вызов `handleConfirmRename`.
   * Нужен потому, что нажатие Enter → blur → оба обработчика вызывают rename одновременно.
   */
  const processingRenameRef = useRef(false);

  /**
   * Ref-флаг: сигнализирует, что blur должен быть проигнорирован.
   * Устанавливается при нажатии Escape, чтобы blur не инициировал сохранение.
   */
  const skipBlurRef = useRef(false);

  /**
   * Оптимистичный список всех списков покупок.
   *
   * Reducer обрабатывает 5 действий:
   *   - `add`     — добавляет список в начало массива (с защитой от дублей).
   *   - `delete`  — удаляет список по id.
   *   - `restore` — возвращает список на исходную позицию при откате удаления.
   *   - `replace` — заменяет временный список (temp-*) реальным из ответа сервера.
   *   - `rename`  — обновляет название списка (оптимистично или откат).
   */
  const [optimisticLists, setOptimisticLists] = useOptimistic(
    allLists,
    (
      state,
      {
        action,
        listId,
        list,
      }: {
        action: "add" | "delete" | "restore" | "replace" | "rename";
        listId?: string;
        list?: ShoppingListData;
      },
    ) => {
      switch (action) {
        case "add":
          if (!list || state.some((item) => item.id === list.id)) {
            return state;
          }
          return [list, ...state];

        case "delete":
          if (!listId) {
            return state;
          }
          return state.filter((item) => item.id !== listId);

        case "restore":
          if (!list || !listId || state.some((item) => item.id === list.id)) {
            return state;
          }
          // Ищем исходную позицию в немутированном `allLists`
          const originalIndex = allLists.findIndex(
            (item) => item.id === listId,
          );
          if (originalIndex < 0) {
            return [...state, list]; // Не нашли позицию — добавляем в конец
          }
          const nextState = [...state];
          nextState.splice(originalIndex, 0, list);
          return nextState;

        case "replace":
          if (!list || !listId) {
            return state;
          }
          return state.map((item) => (item.id === listId ? list : item));

        case "rename":
          if (!list || !listId) {
            return state;
          }
          return state.map((item) =>
            item.id === listId ? { ...item, title: list.title } : item,
          );

        default:
          return state;
      }
    },
  );

  /**
   * Обработчик создания нового списка.
   *
   * Передаётся в `CreateListForm` как колбэк.
   * Выполняет полный цикл оптимистичного обновления:
   *   1. Генерирует временный ID и создаёт placeholder-список.
   *   2. Немедленно добавляет его в UI через `setOptimisticLists`.
   *   3. Вызывает Server Action `createList`.
   *   4. При успехе — заменяет placeholder реальным объектом из БД.
   *   5. При ошибке — удаляет placeholder и показывает alert.
   *
   * @param title - Название нового списка (уже нормализованное).
   * @returns `{ success: boolean }` для `CreateListForm`.
   */
  const handleCreateList = useCallback(
    async (title: string) => {
      const tempListId = `temp-${crypto.randomUUID()}`;

      // Оптимистичный объект с временным ID и данными текущего пользователя
      const optimisticList: ShoppingListData = {
        id: tempListId,
        title,
        ownerId: currentUserId,
        owner: {
          name: currentUserName,
          email: currentUserEmail,
        },
        items: [],
        sharedWith: [],
      };

      startTransition(() => {
        setOptimisticLists({ action: "add", list: optimisticList });
      });

      const formData = new FormData();
      formData.append("title", title);
      const result = await createList(formData);

      if (!result || !result.success) {
        startTransition(() => {
          setOptimisticLists({ action: "delete", listId: tempListId });
        });
        alert(result?.error || "Не удалось создать список");
        return { success: false };
      }

      if (!result.list) {
        startTransition(() => {
          setOptimisticLists({ action: "delete", listId: tempListId });
        });
        alert("Список создан, но возникла ошибка при загрузке данных");
        return { success: false };
      }

      // Заменяем временный список реальным объектом из БД
      startTransition(() => {
        setOptimisticLists({
          action: "replace",
          listId: tempListId,
          list: result.list,
        });
      });

      return { success: true };
    },
    [currentUserEmail, currentUserId, currentUserName, setOptimisticLists],
  );

  /**
   * Обработчик подтверждения переименования списка.
   *
   * Вызывается при нажатии Enter или потере фокуса (blur) полем ввода.
   * Использует `processingRenameRef` для защиты от двойного вызова
   * (Enter → blur оба срабатывают одновременно).
   *
   * @param list - Список, название которого редактировалось.
   */
  const handleConfirmRename = useCallback(
    async (list: ShoppingListData) => {
      // Защита от двойного вызова (Enter + blur)
      if (processingRenameRef.current) return;
      processingRenameRef.current = true;

      try {
        const trimmedTitle = editTitle.trim();
        setEditingListId(null);

        // Если название не изменилось или пустое — ничего не делаем
        if (!trimmedTitle || trimmedTitle === list.title) return;

        // Оптимистично обновляем название в UI
        startTransition(() => {
          setOptimisticLists({
            action: "rename",
            listId: list.id,
            list: { ...list, title: trimmedTitle },
          });
        });

        const formData = new FormData();
        formData.append("listId", list.id);
        formData.append("title", trimmedTitle);
        const result = await renameList(formData);

        if (result && !result.success) {
          // Откат: восстанавливаем исходное название
          startTransition(() => {
            setOptimisticLists({
              action: "rename",
              listId: list.id,
              list,
            });
          });
          alert(result.error || "Не удалось переименовать список");
        }
      } finally {
        processingRenameRef.current = false;
      }
    },
    [editTitle, setOptimisticLists],
  );

  /**
   * Обработчик подтверждения удаления списка.
   *
   * Вызывается из модального окна подтверждения или по нажатию Enter.
   * Выполняет оптимистичное удаление с откатом при ошибке.
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!listToDelete) {
      return;
    }

    const list = listToDelete;
    setIsDeleting(true);
    setListToDelete(null); // Закрываем модал немедленно

    // Оптимистично убираем список из UI
    startTransition(() => {
      setOptimisticLists({ action: "delete", listId: list.id });
    });

    const formData = new FormData();
    formData.append("listId", list.id);
    const result = await deleteList(formData);

    if (result && !result.success) {
      // Откат: возвращаем список на исходную позицию
      startTransition(() => {
        setOptimisticLists({
          action: "restore",
          listId: list.id,
          list,
        });
      });
      alert(result.error || "Не удалось удалить список");
    }

    setIsDeleting(false);
  }, [listToDelete, setOptimisticLists]);

  /**
   * Обработчик подтверждения выхода из расшаренного списка.
   *
   * Оптимистично убирает список из UI, затем вызывает `leaveSharedList`.
   * При ошибке — восстанавливает список на исходной позиции.
   */
  const handleConfirmLeave = useCallback(async () => {
    if (!listToLeave) return;

    const list = listToLeave;
    setIsLeaving(true);
    setListToLeave(null); // Закрываем модал немедленно

    // Оптимистично убираем список из UI
    startTransition(() => {
      setOptimisticLists({ action: "delete", listId: list.id });
    });

    const formData = new FormData();
    formData.append("listId", list.id);
    const result = await leaveSharedList(formData);

    if (result && !result.success) {
      // Откат: возвращаем список на исходную позицию
      startTransition(() => {
        setOptimisticLists({ action: "restore", listId: list.id, list });
      });
      alert(result.error || "Не удалось отписаться от списка");
    }

    setIsLeaving(false);
  }, [listToLeave, setOptimisticLists]);

  /**
   * Эффект: клавиатурные события при открытом модале выхода из списка.
   *
   * - `Escape` — закрывает модал.
   * - `Enter`  — подтверждает выход.
   */
  useEffect(() => {
    if (!listToLeave) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setListToLeave(null);
        return;
      }
      if (event.key === "Enter" && !isLeaving) {
        event.preventDefault();
        void handleConfirmLeave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleConfirmLeave, isLeaving, listToLeave]);

  /**
   * Эффект: подписка на клавиатурные события при открытом модале.
   *
   * - `Escape` — закрывает модал без удаления.
   * - `Enter`  — подтверждает удаление (если не идёт другое удаление).
   *
   * Подписка активна только пока `listToDelete !== null`.
   * Отписка происходит автоматически при закрытии модала.
   */
  useEffect(() => {
    if (!listToDelete) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setListToDelete(null);
        return;
      }

      if (event.key === "Enter" && !isDeleting) {
        event.preventDefault();
        void handleConfirmDelete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleConfirmDelete, isDeleting, listToDelete]);

  return (
    <>
      {/* Блок создания нового списка */}
      <div className="bg-white p-6 rounded-xl shadow-sm mb-8 border border-blue-100">
        <h3 className="text-lg font-semibold mb-3">Создать новый список 📝</h3>
        <CreateListForm onCreateList={handleCreateList} />
      </div>

      {/* Лента всех списков */}
      <div className="space-y-6">
        {optimisticLists.map((list) => (
          <div
            key={list.id}
            className="border p-6 rounded-xl shadow-sm bg-white"
          >
            {/* Индикатор ожидания для оптимистичного списка */}
            {list.id.startsWith("temp-") && (
              <div className="mb-3 text-xs text-blue-600 font-medium">
                Создаём список...
              </div>
            )}

            {/* Заголовок и кнопки управления */}
            <div className="mb-4 border-b pb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {editingListId === list.id ? (
                  <input
                    autoFocus
                    className="text-xl font-bold w-full border p-1 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 ring-blue-500 outline-none transition"
                    value={editTitle}
                    maxLength={50}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleConfirmRename(list);
                      }
                      if (e.key === "Escape") {
                        skipBlurRef.current = true;
                        setEditingListId(null);
                      }
                    }}
                    onBlur={() => {
                      if (skipBlurRef.current) {
                        skipBlurRef.current = false;
                        return;
                      }
                      void handleConfirmRename(list);
                    }}
                  />
                ) : (
                  <h2 className="text-xl font-bold truncate">{list.title}</h2>
                )}
              </div>

              {/* Кнопки переименования и удаления: только для владельца и только для реальных списков */}
              {list.ownerId === currentUserId &&
                !list.id.startsWith("temp-") && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {editingListId !== list.id && (
                      <button
                        type="button"
                        aria-label={`Переименовать список ${list.title}`}
                        onClick={() => {
                          setEditingListId(list.id);
                          setEditTitle(list.title);
                        }}
                        className="text-gray-400 hover:text-blue-500 text-base px-2 py-1 leading-none"
                      >
                        ✎
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Удалить список ${list.title}`}
                      disabled={isDeleting}
                      onClick={() => setListToDelete(list)}
                      className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1"
                    >
                      ✕
                    </button>
                  </div>
                )}
            </div>

            {/* Список товаров: рендерится только для реальных (не temp) списков */}
            {!list.id.startsWith("temp-") && (
              <ShoppingList
                items={list.items}
                listId={list.id}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                currentUserEmail={currentUserEmail}
                sharedUsersCount={list.sharedWith.length}
              />
            )}

            {/* Форма совместного доступа: только для владельца и только для реальных списков */}
            {list.ownerId === currentUserId && !list.id.startsWith("temp-") && (
              <ShareListForm listId={list.id} sharedWith={list.sharedWith} />
            )}

            {/* Подпись владельца + кнопка Отписаться от списка: только для гостевого доступа */}
            {list.ownerId !== currentUserId && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  Владелец: {list.owner.name || list.owner.email}
                </span>
                <button
                  type="button"
                  disabled={isLeaving}
                  onClick={() => setListToLeave(list)}
                  className="text-xs text-red-400 hover:text-red-600 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Отписаться от списка
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Сообщение о пустом состоянии */}
        {optimisticLists.length === 0 && (
          <div className="text-center py-10 border-2 border-dashed rounded-xl">
            <p className="text-gray-500">У вас пока нет списков.</p>
            <p className="text-sm text-gray-400" />
          </div>
        )}
      </div>

      {/* -----------------------------------------------------------------------
          Модальное окно подтверждения удаления.
          Отображается только если listToDelete !== null.
          Клик на фон (overlay) — закрыть без удаления.
          Клик внутри модала — не закрывает (stopPropagation).
      ----------------------------------------------------------------------- */}
      {/* -----------------------------------------------------------------------
          Модальное окно подтверждения выхода из расшаренного списка.
      ----------------------------------------------------------------------- */}
      {listToLeave && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setListToLeave(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">
              Отписаться от списка?
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              Вы хотите отписаться от списка «{listToLeave.title}»? Чтобы снова
              получить доступ, попросите владельца поделиться им заново.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setListToLeave(null)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmLeave}
                className="px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700"
              >
                Отписаться
              </button>
            </div>
          </div>
        </div>
      )}

      {listToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setListToDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-2">Удалить список?</h3>
            <p className="text-sm text-gray-600 mb-5">
              Вы действительно хотите удалить список «{listToDelete.title}»?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setListToDelete(null)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
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
