/**
 * @file ListsContainer.tsx
 * @description Контейнер всех списков пользователя.
 *
 * Client Component (`"use client"`).
 *
 * Это главный клиентский компонент приложения. Он:
 *   - Отображает все списки (свои и расшаренные).
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
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  createList,
  deleteList,
  renameList,
  leaveSharedList,
} from "@/app/actions";
import toast from "react-hot-toast";
import SmartList from "@/app/components/SmartList";
import Highlight from "@/app/components/Highlight";
import ShareListForm from "@/app/components/ShareListForm";
import CreateListForm from "@/app/components/CreateListForm";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { getPusherClient } from "@/lib/pusher-client";

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

/** Запись внутри списка. */
type Item = {
  id: string;
  name: string;
  isCompleted: boolean;
  addedBy: { id: string; name: string | null; email: string } | null;
};

/** Полные данные списка (включая связанные сущности). */
type ListData = {
  id: string;
  title: string;
  ownerId: string;
  owner: ListOwner;
  items: Item[];
  sharedWith: SharedUser[];
};

/** Пропсы компонента `ListCard`. */
type ListCardProps = {
  list: ListData;
  currentUserId: string;
  currentUserName: string | null;
  currentUserEmail: string;
  showAuthors: boolean;
  isDeleting: boolean;
  isLeaving: boolean;
  onRename: (listId: string, newTitle: string, originalList: ListData) => Promise<void>;
  onDelete: (list: ListData) => void;
  onLeave: (list: ListData) => void;
  /** Активный поисковый запрос для подсветки совпадений (пустая строка = нет поиска). */
  searchQuery: string;
};


/**
 * Мемоизированная карточка одного списка.
 *
 * Изолирует состояние редактирования (editingListId, editTitle) внутри себя,
 * чтобы ре-рендер при поиске или изменении другой карточки не затрагивал её.
 */
const ListCard = memo(function ListCard({
  list,
  currentUserId,
  currentUserName,
  currentUserEmail,
  showAuthors,
  isDeleting,
  isLeaving,
  onRename,
  onDelete,
  onLeave,
  searchQuery,
}: ListCardProps) {
  const t = useTranslations("ListsContainer");

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const processingRenameRef = useRef(false);
  const skipBlurRef = useRef(false);

  const handleConfirmRename = useCallback(async () => {
    if (processingRenameRef.current) return;
    processingRenameRef.current = true;
    try {
      const trimmed = editTitle.trim();
      setIsEditing(false);
      if (!trimmed || trimmed === list.title) return;
      await onRename(list.id, trimmed, list);
    } finally {
      processingRenameRef.current = false;
    }
  }, [editTitle, list, onRename]);

  const isOwner = list.ownerId === currentUserId;
  const isTemp = list.id.startsWith("temp-");

  return (
    <div className="break-inside-avoid mb-6 border p-6 rounded-xl shadow-sm bg-white">
      {/* Заголовок и кнопки управления */}
      <div className="mb-4 border-b pb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isEditing ? (
            <input
              autoFocus
              className="text-xl font-bold w-full border p-1 rounded-lg bg-gray-50 focus:bg-white focus:ring-1 ring-gray-800 outline-none transition"
              value={editTitle}
              maxLength={50}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleConfirmRename();
                }
                if (e.key === "Escape") {
                  skipBlurRef.current = true;
                  setIsEditing(false);
                }
              }}
              onBlur={() => {
                if (skipBlurRef.current) {
                  skipBlurRef.current = false;
                  return;
                }
                void handleConfirmRename();
              }}
            />
          ) : isOwner && !isTemp ? (
            <div
              className="group inline-flex items-center gap-1 min-w-0 rounded-lg px-1 -mx-1 hover:bg-gray-100 hover:ring-1 hover:ring-gray-300 transition-colors cursor-pointer"
              onClick={() => {
                setIsEditing(true);
                setEditTitle(list.title);
              }}
            >
              <h2 className="text-xl font-bold truncate"><Highlight text={list.title} query={searchQuery} /></h2>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 text-base flex-shrink-0">
                ✎
              </span>
            </div>
          ) : (
            <h2 className="text-xl font-bold truncate"><Highlight text={list.title} query={searchQuery} /></h2>
          )}
        </div>

        {/* Кнопки переименования и удаления: только для владельца и только для реальных списков */}
        {isOwner && !isTemp && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {isEditing ? (
              <>
                <button
                  type="button"
                  aria-label="Сохранить"
                  onMouseDown={() => { skipBlurRef.current = true; }}
                  onClick={() => void handleConfirmRename()}
                  className="hidden sm:inline-flex text-green-600 hover:text-white hover:bg-green-600 text-base px-2 py-1 leading-none rounded transition"
                >
                  ✓
                </button>
                <button
                  type="button"
                  aria-label="Отменить"
                  onMouseDown={() => { skipBlurRef.current = true; }}
                  onClick={() => setIsEditing(false)}
                  className="text-gray-400 hover:text-white hover:bg-gray-500 text-base px-2 py-1 leading-none rounded transition"
                >
                  ✗
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label={t("ariaDelete", { title: list.title })}
                disabled={isDeleting}
                onClick={() => onDelete(list)}
                className="text-red-500 hover:text-red-700 text-xs font-bold px-2 py-1"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Skeleton-заглушка для temp-списка */}
      {isTemp && (
        <div className="space-y-2 animate-pulse" aria-hidden>
          <div className="h-4 bg-gray-100 rounded w-3/4" />
          <div className="h-4 bg-gray-100 rounded w-1/2" />
          <div className="h-4 bg-gray-100 rounded w-2/3" />
        </div>
      )}

      {/* Список записей */}
      {!isTemp && (
        <SmartList
          items={list.items}
          listId={list.id}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          currentUserEmail={currentUserEmail}
          showAuthors={showAuthors}
          searchQuery={searchQuery}
        />
      )}

      {/* Форма совместного доступа */}
      {isOwner && !isTemp && (
        <ShareListForm listId={list.id} sharedWith={list.sharedWith} />
      )}

      {/* Подпись владельца + кнопка Отписаться */}
      {!isOwner && (
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {t("owner", { name: list.owner.name || list.owner.email })}
          </span>
          <button
            type="button"
            disabled={isLeaving}
            onClick={() => onLeave(list)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 4h3a2 2 0 0 1 2 2v14" />
              <path d="M2 20h3" />
              <path d="M13 20h9" />
              <path d="M10 12v.01" />
              <path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z" />
            </svg>
            {t("unsubscribe")}
          </button>
        </div>
      )}
    </div>
  );
});

/** Пропсы компонента `ListsContainer`. */
type ListsContainerProps = {
  /** Все списки, доступные пользователю (свои + расшаренные). Загружаются на сервере. */
  allLists: ListData[];
  /** ID текущего авторизованного пользователя. Используется для проверки прав. */
  currentUserId: string;
  /** Имя текущего пользователя (для оптимистичного placeholder нового списка). */
  currentUserName: string | null;
  /** Email текущего пользователя (аналогично). */
  currentUserEmail: string;
};

/**
 * Главный контейнер списков.
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
  const t = useTranslations("ListsContainer");
  const router = useRouter();

  /**
   * Список, ожидающий подтверждения удаления.
   * `null` означает, что модальное окно закрыто.
   */
  const [listToDelete, setListToDelete] = useState<ListData | null>(null);

  /** Флаг ожидания ответа сервера при удалении. Блокирует повторные запросы. */
  const [isDeleting, setIsDeleting] = useState(false);

  /**
   * Расшаренный список, от которого пользователь хочет отписаться.
   * `null` означает, что модальное окно закрыто.
   */
  const [listToLeave, setListToLeave] = useState<ListData | null>(null);

  /** Флаг ожидания ответа сервера при выходе из расшаренного списка. */
  const [isLeaving, setIsLeaving] = useState(false);

  /** Глобальный флаг отображения авторов записей. Сохраняется в localStorage. */
  const [showAuthors, setShowAuthors] = useState<boolean>(false);
  // isSearchOpen: управляет видимостью поля поиска. Сохраняется в localStorage.
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // isSearching: true в промежутке между вводом и применением дебаунса —
  // используется для показа лоадера в поле поиска.
  const [isSearching, setIsSearching] = useState(false);
  // isPending: true пока React рендерит результаты поиска (низкоприоритетный переход)
  const [isPending, startTransition] = useTransition();

  // Debounce: применяем поисковый запрос с задержкой 350мс,
  // чтобы не пересчитывать filteredLists при каждом нажатии клавиши.
  // startTransition помечает обновление searchQuery как низкоприоритетное —
  // React не блокирует UI пока пересчитывает filteredLists.
  useEffect(() => {
    if (searchInput !== searchQuery) setIsSearching(true);
    const timer = setTimeout(() => {
      startTransition(() => {
        setSearchQuery(searchInput);
      });
      setIsSearching(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Читаем сохранённые значения из localStorage только после гидрации,
  // чтобы не было расхождения между серверным и клиентским HTML.
  useEffect(() => {
    setShowAuthors(localStorage.getItem("showAuthors") === "true");
    setIsSearchOpen(localStorage.getItem("activeTab") === "search");
  }, []);

  /**
   * Эффект: подписка на личный private-канал Pusher текущего пользователя.
   *
   * Используется private-user-* канал (не публичный), что требует прохождения
   * auth endpoint (/api/pusher/auth) — сервер проверяет, что пользователь
   * подписывается только на свой канал. Это предотвращает слежку за чужой активностью.
   *
   * При получении события `refresh` вызывает `router.refresh()` —
   * Next.js перезапрашивает Server Component с актуальными данными из БД.
   * Это обеспечивает real-time обновление у всех участников списка.
   */
  useEffect(() => {
    const client = getPusherClient();
    const channel = client.subscribe(`private-user-${currentUserId}`);

    channel.bind("refresh", () => {
      router.refresh();
    });

    return () => {
      channel.unbind_all();
      client.unsubscribe(`private-user-${currentUserId}`);
    };
  }, [currentUserId, router]);

  const toggleShowAuthors = () => {
    setShowAuthors((prev) => {
      const next = !prev;
      localStorage.setItem("showAuthors", String(next));
      return next;
    });
  };

  /**
   * Карта стабильных ключей для рендера карточек списков.
   * Сопоставляет listId → renderKey, чтобы при замене temp-списка реальным
   * React видел тот же ключ и не запускал exit/enter анимацию.
   */
  const stableKeys = useRef(new Map<string, string>());

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
        list?: ListData;
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
   * Отфильтрованные списки по поисковому запросу.
   * Если запрос пустой — возвращает все списки.
   * Если совпадает название — показывает список со всеми записями.
   * Иначе — ищет совпадения внутри записей и показывает только их.
   */
  const filteredLists = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return optimisticLists;

    return optimisticLists.reduce<typeof optimisticLists>((acc, list) => {
      const titleMatches = list.title.toLowerCase().includes(q);

      if (titleMatches) {
        // Название совпало — показываем список со всеми записями
        acc.push(list);
      } else {
        // Ищем совпадения внутри записей
        const matchedItems = list.items.filter((item) =>
          item.name.toLowerCase().includes(q),
        );
        if (matchedItems.length > 0) {
          acc.push({ ...list, items: matchedItems });
        }
      }
      return acc;
    }, []);
  }, [optimisticLists, searchQuery]);

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
      const optimisticList: ListData = {
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

      // Регистрируем стабильный ключ для рендера: tempId → tempId
      stableKeys.current.set(tempListId, tempListId);

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
        toast.error(t("errors.createFailed"));
        return { success: false };
      }

      if (!result.list) {
        startTransition(() => {
          setOptimisticLists({ action: "delete", listId: tempListId });
        });
        toast.error(t("errors.createLoadFailed"));
        return { success: false };
      }

      // Переносим стабильный ключ: теперь realId тоже рендерится под tempId
      stableKeys.current.set(result.list.id, tempListId);

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
   * Колбэк переименования для `ListCard`.
   * Вызывается уже с обрезанным новым названием.
   */
  const handleRename = useCallback(
    async (listId: string, newTitle: string, originalList: ListData) => {
      // Оптимистично обновляем название в UI
      startTransition(() => {
        setOptimisticLists({
          action: "rename",
          listId,
          list: { ...originalList, title: newTitle },
        });
      });

      const formData = new FormData();
      formData.append("listId", listId);
      formData.append("title", newTitle);
      const result = await renameList(formData);

      if (result && !result.success) {
        // Откат: восстанавливаем исходное название
        startTransition(() => {
          setOptimisticLists({ action: "rename", listId, list: originalList });
        });
        toast.error(t("errors.renameFailed"));
      }
    },
    [setOptimisticLists, t],
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
      toast.error(t("errors.deleteFailed"));
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
      toast.error(t("errors.leaveFailed"));
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
      {/* Карточка с вкладками: Создать / Поиск */}
      <div className="bg-white rounded-xl shadow-sm mb-4 border border-blue-100">
        {/* Вкладки + переключатель авторов */}
        <div className="flex items-center gap-1 p-2 border-b border-gray-100">
          {/* Вкладка "Создать" */}
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(false);
              setSearchInput("");
              localStorage.setItem("activeTab", "create");
            }}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              !isSearchOpen
                ? "bg-gray-800 text-white"
                : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            {t("tabCreate")}
          </button>

          {/* Вкладка "Поиск" */}
          <button
            type="button"
            onClick={() => {
              setIsSearchOpen(true);
              localStorage.setItem("activeTab", "search");
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              isSearchOpen
                ? "bg-gray-800 text-white"
                : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            {t("tabSearch")}
          </button>

          {/* Переключатель авторов — прижат вправо */}
          <div className="flex items-center gap-2 ml-auto px-2">
            <button
              type="button"
              onClick={() => toggleShowAuthors()}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                showAuthors ? "bg-blue-500" : "bg-gray-200"
              }`}
              role="switch"
              aria-checked={showAuthors}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200 ${
                  showAuthors ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
            <span className="text-xs text-gray-400">{t("showAuthors")}</span>
          </div>
        </div>

        {/* Контент вкладки */}
        <div className="p-6">
          {!isSearchOpen ? (
            <CreateListForm onCreateList={handleCreateList} />
          ) : (
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                ref={searchInputRef}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setIsSearchOpen(false);
                    setSearchInput("");
                    localStorage.setItem("activeTab", "create");
                  }
                }}
                placeholder={t("searchPlaceholder")}
                className="w-full border rounded-lg pl-8 pr-8 p-3 bg-gray-50 focus:bg-white focus:ring-1 ring-gray-800 outline-none transition"
              />
              {(isSearching || isPending) && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Плашка с результатами поиска */}
      {searchQuery && (
        <div className="flex items-center justify-between mb-4 px-1">
          <span className="text-sm text-gray-500">
            {t("searchResults", { found: filteredLists.length, total: optimisticLists.length })}
          </span>
          <button
            type="button"
            onClick={() => { setIsSearchOpen(false); setSearchInput(""); localStorage.setItem("activeTab", "create"); }}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            {t("closeSearch")} ✕
          </button>
        </div>
      )}

      <div className="columns-1 md:columns-2 xl:columns-3 gap-6">
        <AnimatePresence initial={false}>
          {filteredLists.map((list) => (
            <motion.div
              key={stableKeys.current.get(list.id) ?? list.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="break-inside-avoid mb-6"
            >
              <ListCard
                list={list}
                currentUserId={currentUserId}
                currentUserName={currentUserName}
                currentUserEmail={currentUserEmail}
                showAuthors={showAuthors}
                isDeleting={isDeleting}
                isLeaving={isLeaving}
                onRename={handleRename}
                onDelete={setListToDelete}
                onLeave={setListToLeave}
                searchQuery={searchQuery}
              />
            </motion.div>
          ))}
        </AnimatePresence>

      </div>

      {/* Сообщение о пустом состоянии — вне columns-контейнера */}
      {filteredLists.length === 0 && (
        <div className="text-center py-10 border-2 border-dashed rounded-xl">
          <p className="text-gray-500">
            {searchQuery.trim() ? t("noSearchResults") : t("noLists")}
          </p>
        </div>
      )}

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
              {t("leaveModal.title")}
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              {t("leaveModal.body", { title: listToLeave.title })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setListToLeave(null)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-50"
              >
                {t("leaveModal.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmLeave}
                className="px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700"
              >
                {t("leaveModal.confirm")}
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
            <h3 className="text-lg font-semibold mb-2">
              {t("deleteModal.title")}
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              {t("deleteModal.body", { title: listToDelete.title })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setListToDelete(null)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 hover:bg-gray-50"
              >
                {t("deleteModal.cancel")}
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
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
