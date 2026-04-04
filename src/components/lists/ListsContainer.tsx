/**
 * @file ListsContainer.tsx
 * @description Главный контейнер списков пользователя.
 *
 * Client Component (`"use client"`).
 *
 * Компонент отвечает исключительно за управление состоянием и координацию
 * дочерних компонентов. Весь UI вынесен в отдельные компоненты:
 *   - `ListCard`      — карточка отдельного списка.
 *   - `ListsTopPanel` — панель с вкладками Создать/Поиск и переключателем авторов.
 *   - `ConfirmModal`  — переиспользуемый модал подтверждения действия.
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
 *   - `rename`  — обновить название списка (оптимистично или откат).
 *
 * Удаление через модальное окно:
 *   Клик на ✕ → модал → подтверждение/отмена (или Esc/Enter с клавиатуры).
 */

"use client";

import {
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
  createGroup,
  deleteGroup,
  renameGroup,
  addListToGroup,
  removeListFromGroup,
} from "@/app/actions";
import toast from "react-hot-toast";
import CreateListForm from "@/components/lists/CreateListForm";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { getPusherClient } from "@/lib/pusher-client";
import ListCard, { type ListData, type ListGroup } from "@/components/lists/ListCard";
import ListsTopPanel from "@/components/lists/ListsTopPanel";
import ConfirmModal from "@/components/ui/ConfirmModal";
import GroupFilter from "@/components/lists/GroupFilter";

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
  /** Группы списков текущего пользователя. */
  userGroups: ListGroup[];
};

/**
 * Главный контейнер списков.
 *
 * Управляет состоянием и координирует дочерние компоненты:
 * `ListCard`, `ListsTopPanel`, `ConfirmModal`.
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
  userGroups: initialGroups,
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

  /** Группы пользователя (оптимистично обновляемые). */
  const [groups, setGroups] = useState<ListGroup[]>(initialGroups);

  /** Группа, ожидающая подтверждения удаления. null — модал закрыт. */
  const [groupToDelete, setGroupToDelete] = useState<ListGroup | null>(null);

  /** Флаг ожидания ответа сервера при удалении группы. */
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);

  /** Активный фильтр группы. null = показывать все списки. Сохраняется в localStorage. */
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

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
  const [isPending, startSearchTransition] = useTransition();

  // Debounce: применяем поисковый запрос с задержкой 350мс,
  // чтобы не пересчитывать filteredLists при каждом нажатии клавиши.
  // startSearchTransition помечает обновление searchQuery как низкоприоритетное —
  // React не блокирует UI пока пересчитывает filteredLists.
  useEffect(() => {
    if (searchInput !== searchQuery) setIsSearching(true);
    const timer = setTimeout(() => {
      startSearchTransition(() => {
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
    const savedGroupId = localStorage.getItem("activeGroupId");
    if (savedGroupId) setActiveGroupId(savedGroupId);
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
   * Отфильтрованные списки: сначала по группе, затем по поисковому запросу.
   */
  const filteredLists = useMemo(() => {
    // Шаг 1: фильтр по активной группе
    const groupFiltered = activeGroupId
      ? optimisticLists.filter((list) =>
          list.groups.some((g) => g.id === activeGroupId),
        )
      : optimisticLists;

    // Шаг 2: фильтр по поисковому запросу
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groupFiltered;

    return groupFiltered.reduce<typeof groupFiltered>((acc, list) => {
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
  }, [optimisticLists, searchQuery, activeGroupId]);

  // -------------------------------------------------------------------------
  // Обработчики для групп
  // -------------------------------------------------------------------------

  const handleSelectGroup = useCallback((groupId: string | null) => {
    setActiveGroupId(groupId);
    if (groupId) {
      localStorage.setItem("activeGroupId", groupId);
    } else {
      localStorage.removeItem("activeGroupId");
    }
  }, []);

  const handleCreateGroup = useCallback(async (name: string) => {
    const formData = new FormData();
    formData.append("name", name);
    const result = await createGroup(formData);
    if (result.success && result.group) {
      setGroups((prev) => [...prev, result.group!]);
    } else {
      toast.error(t("errors.groupCreateFailed"));
    }
  }, [t]);

  /** Открывает модал подтверждения удаления группы. */
  const handleDeleteGroup = useCallback((groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (group) setGroupToDelete(group);
  }, [groups]);

  /** Подтверждение удаления группы из модала. */
  const handleConfirmDeleteGroup = useCallback(async () => {
    if (!groupToDelete) return;

    const group = groupToDelete;
    setIsDeletingGroup(true);
    setGroupToDelete(null); // Закрываем модал немедленно

    // Если удаляем активную группу — сбрасываем фильтр
    if (activeGroupId === group.id) {
      handleSelectGroup(null);
    }
    setGroups((prev) => prev.filter((g) => g.id !== group.id));

    const formData = new FormData();
    formData.append("groupId", group.id);
    const result = await deleteGroup(formData);
    if (!result.success) {
      // Откат: восстанавливаем группу на исходную позицию
      const restored = initialGroups.find((g) => g.id === group.id);
      if (restored) setGroups((prev) =>
        [...prev, restored].sort(
          (a, b) =>
            initialGroups.findIndex((g) => g.id === a.id) -
            initialGroups.findIndex((g) => g.id === b.id),
        ),
      );
      toast.error(t("errors.groupDeleteFailed"));
    }

    setIsDeletingGroup(false);
  }, [groupToDelete, activeGroupId, handleSelectGroup, initialGroups, t]);

  const handleRenameGroup = useCallback(async (groupId: string, newName: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, name: newName } : g)),
    );

    const formData = new FormData();
    formData.append("groupId", groupId);
    formData.append("name", newName);
    const result = await renameGroup(formData);
    if (!result.success) {
      // Откат: восстанавливаем старое имя
      const original = initialGroups.find((g) => g.id === groupId);
      if (original) {
        setGroups((prev) =>
          prev.map((g) => (g.id === groupId ? original : g)),
        );
      }
      toast.error(t("errors.groupRenameFailed"));
    }
  }, [initialGroups, t]);

  const handleToggleListGroup = useCallback(
    async (listId: string, groupId: string, inGroup: boolean) => {
      const formData = new FormData();
      formData.append("groupId", groupId);
      formData.append("listId", listId);
      const action = inGroup ? removeListFromGroup : addListToGroup;
      const result = await action(formData);
      if (!result.success) {
        toast.error(t("errors.groupAssignFailed"));
      }
      // router.refresh подхватит актуальные данные через Pusher/revalidatePath
    },
    [t],
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

      // Если активна группа — оптимистично включаем список в неё сразу
      const activeGroup = activeGroupId
        ? (groups.find((g) => g.id === activeGroupId) ?? null)
        : null;

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
        groups: activeGroup ? [activeGroup] : [],
      };

      // Регистрируем стабильный ключ для рендера: tempId → tempId
      stableKeys.current.set(tempListId, tempListId);

      startTransition(() => {
        setOptimisticLists({ action: "add", list: optimisticList });
      });

      const formData = new FormData();
      formData.append("title", title);
      // Передаём активную группу — сервер подключит список к ней сразу
      if (activeGroupId) formData.append("groupId", activeGroupId);
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
    [currentUserEmail, currentUserId, currentUserName, setOptimisticLists, activeGroupId, groups],
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
   * Эффект: подписка на клавиатурные события при открытом модале удаления.
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

  /**
   * Эффект: клавиатурные события при открытом модале удаления группы.
   *
   * - `Escape` — закрывает модал.
   * - `Enter`  — подтверждает удаление.
   */
  useEffect(() => {
    if (!groupToDelete) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setGroupToDelete(null);
        return;
      }
      if (event.key === "Enter" && !isDeletingGroup) {
        event.preventDefault();
        void handleConfirmDeleteGroup();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleConfirmDeleteGroup, isDeletingGroup, groupToDelete]);

  return (
    <>
      {/* Фильтр по группам */}
      <GroupFilter
        groups={groups}
        activeGroupId={activeGroupId}
        onSelectGroup={handleSelectGroup}
        onCreateGroup={handleCreateGroup}
        onDeleteGroup={handleDeleteGroup}
        onRenameGroup={handleRenameGroup}
      />

      {/* Панель с вкладками Создать/Поиск и переключателем авторов */}
      <ListsTopPanel
        isSearchOpen={isSearchOpen}
        searchInput={searchInput}
        isSearching={isSearching}
        isPending={isPending}
        showAuthors={showAuthors}
        searchInputRef={searchInputRef}
        onTabCreate={() => {
          setIsSearchOpen(false);
          setSearchInput("");
          localStorage.setItem("activeTab", "create");
        }}
        onTabSearch={() => {
          setIsSearchOpen(true);
          localStorage.setItem("activeTab", "search");
          requestAnimationFrame(() => searchInputRef.current?.focus());
        }}
        onSearchChange={(value) => setSearchInput(value)}
        onSearchEscape={() => {
          setIsSearchOpen(false);
          setSearchInput("");
          localStorage.setItem("activeTab", "create");
        }}
        onToggleAuthors={toggleShowAuthors}
        createListContent={<CreateListForm onCreateList={handleCreateList} />}
      />

      {/* Плашка с результатами поиска */}
      {searchQuery && (
        <div className="flex items-center justify-between mb-4 px-1">
          <span className="text-sm text-gray-500">
            {t("searchResults", { found: filteredLists.length, total: optimisticLists.length })}
          </span>
          <button
            type="button"
            onClick={() => { setIsSearchOpen(false); setSearchInput(""); localStorage.setItem("activeTab", "create"); }}
            className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 transition-colors"
          >
            {t("closeSearch")} ✕
          </button>
        </div>
      )}

      {/* Внешний AnimatePresence реагирует на смену группы:
          mode="wait" гарантирует, что старые карточки полностью исчезнут
          до появления новых — устраняет прыжки columns-layout. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeGroupId ?? "all"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <div className="columns-1 md:columns-2 xl:columns-3 gap-6">
            {/* Внутренний AnimatePresence обрабатывает добавление/удаление
                отдельных списков внутри группы. */}
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
                    userGroups={groups}
                    onToggleListGroup={handleToggleListGroup}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Сообщение о пустом состоянии */}
          {filteredLists.length === 0 && (
            <div className="text-center py-10 border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-xl">
              <p className="text-gray-500 dark:text-zinc-400">
                {searchQuery.trim() ? t("noSearchResults") : t("noLists")}
              </p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Модал подтверждения выхода из расшаренного списка */}
      {listToLeave && (
        <ConfirmModal
          title={t("leaveModal.title")}
          body={t("leaveModal.body", { title: listToLeave.title })}
          confirmLabel={t("leaveModal.confirm")}
          cancelLabel={t("leaveModal.cancel")}
          isConfirming={isLeaving}
          onConfirm={() => void handleConfirmLeave()}
          onCancel={() => setListToLeave(null)}
        />
      )}

      {/* Модал подтверждения удаления списка */}
      {listToDelete && (
        <ConfirmModal
          title={t("deleteModal.title")}
          body={t("deleteModal.body", { title: listToDelete.title })}
          confirmLabel={t("deleteModal.confirm")}
          cancelLabel={t("deleteModal.cancel")}
          isConfirming={isDeleting}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setListToDelete(null)}
        />
      )}

      {/* Модал подтверждения удаления группы */}
      {groupToDelete && (
        <ConfirmModal
          title={t("deleteGroupModal.title")}
          body={t("deleteGroupModal.body", { name: groupToDelete.name })}
          confirmLabel={t("deleteGroupModal.confirm")}
          cancelLabel={t("deleteGroupModal.cancel")}
          isConfirming={isDeletingGroup}
          onConfirm={() => void handleConfirmDeleteGroup()}
          onCancel={() => setGroupToDelete(null)}
        />
      )}
    </>
  );
}
