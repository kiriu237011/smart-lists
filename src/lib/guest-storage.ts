/**
 * @file guest-storage.ts
 * @description Гостевое хранилище списков в localStorage браузера.
 *
 * Клиентский модуль (использует localStorage — импортировать только из
 * клиентских компонентов).
 *
 * Гостевой режим: пользователь работает без аккаунта, данные НЕ попадают
 * в БД — всё хранится локально в этом браузере под ключом `guest-data-v1`.
 * Версия в ключе позволяет в будущем мигрировать формат без конфликтов.
 *
 * Модуль экспортирует:
 *   - `loadGuestData()` / типы — чтение и Zod-валидация сырых данных;
 *   - `toListData()` — преобразование в формат `ListData`, который ожидают
 *     компоненты (`ListsContainer`, `ListCard`, `SmartList`);
 *   - `createGuestListsApi()` — гостевую реализацию адаптера `ListsApi`
 *     (см. `ListsApiProvider.tsx`): те же контракты, что у Server Actions,
 *     но операции выполняются синхронно над localStorage.
 *
 * Валидация входных данных — теми же Zod-схемами, что и на сервере
 * (`src/lib/validations.ts`): лимиты длины и коды ошибок ("tooLong")
 * полностью совпадают с серверным поведением.
 *
 * Задел на будущее: данные гостя лежат в одном ключе, поэтому «перенос
 * в аккаунт» при регистрации сведётся к одному чтению + Server Action.
 */

import { z } from "zod";
import { ZodError } from "zod";
import {
  createItemSchema,
  renameItemSchema,
  createListSchema,
  renameListSchema,
  createGroupSchema,
  renameGroupSchema,
} from "@/lib/validations";
import type { ListData, ListGroup } from "@/components/lists/ListCard";
import type { ListsApi } from "@/components/providers/ListsApiProvider";
import { randomUUID } from "@/lib/uuid";

// ---------------------------------------------------------------------------
// Схема хранимых данных
// ---------------------------------------------------------------------------

/** Ключ localStorage. Суффикс версии — на случай смены формата. */
const STORAGE_KEY = "guest-data-v1";

/** Фиктивный ID гостя: подставляется в ownerId/addedBy вместо ID из БД. */
export const GUEST_USER_ID = "guest";

/** Запись в гостевом списке (минимальный набор полей). */
const storedItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  isCompleted: z.boolean(),
});

/** Гостевой список. Порядок в массиве = порядок отображения (новые сверху). */
const storedListSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** ID групп, к которым привязан список. */
  groupIds: z.array(z.string()),
  /** Записи в порядке добавления (как orderBy createdAt asc на сервере). */
  items: z.array(storedItemSchema),
});

/** Гостевая группа списков. */
const storedGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/** Все гостевые данные под одним ключом localStorage. */
const guestDataSchema = z.object({
  lists: z.array(storedListSchema),
  groups: z.array(storedGroupSchema),
});

export type GuestData = z.infer<typeof guestDataSchema>;
type StoredList = z.infer<typeof storedListSchema>;

// ---------------------------------------------------------------------------
// Чтение / запись localStorage
// ---------------------------------------------------------------------------

const EMPTY_DATA: GuestData = { lists: [], groups: [] };

/**
 * Читает гостевые данные из localStorage.
 * Повреждённые или отсутствующие данные заменяются пустым состоянием —
 * safeParse гарантирует, что в компоненты не попадёт неожиданная структура.
 */
export function loadGuestData(): GuestData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DATA;

    const result = guestDataSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : EMPTY_DATA;
  } catch {
    // JSON.parse упал или localStorage недоступен (privacy mode)
    return EMPTY_DATA;
  }
}

/**
 * Сохраняет гостевые данные.
 * @returns false, если запись не удалась (например, квота localStorage).
 */
function saveGuestData(data: GuestData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Генерирует ID гостевой сущности. Префикс отличает от CUID из БД. */
function guestId(): string {
  return `guest-${randomUUID()}`;
}

/** Код ошибки валидации — та же логика, что в Server Actions. */
function getValidationError(error: ZodError): string {
  return error.issues.some((i) => i.code === "too_big") ? "tooLong" : "validationError";
}

// ---------------------------------------------------------------------------
// Преобразование в формат компонентов
// ---------------------------------------------------------------------------

/**
 * Преобразует один хранимый список в `ListData` для компонентов.
 * Гость всегда владелец: sharedWith/files пусты, addedBy — сам гость.
 *
 * @param list - Хранимый список.
 * @param groups - Все гостевые группы (для резолва groupIds → {id, name}).
 * @param guestName - Локализованное имя гостя (показывается как автор/владелец).
 */
function storedListToListData(
  list: StoredList,
  groups: ListGroup[],
  guestName: string,
): ListData {
  const guestUser = { id: GUEST_USER_ID, name: guestName, email: "" };
  return {
    id: list.id,
    title: list.title,
    ownerId: GUEST_USER_ID,
    owner: { name: guestName, email: "" },
    items: list.items.map((item) => ({
      id: item.id,
      name: item.name,
      isCompleted: item.isCompleted,
      addedBy: guestUser,
    })),
    sharedWith: [],
    groups: groups.filter((g) => list.groupIds.includes(g.id)),
    files: [],
  };
}

/** Преобразует все гостевые данные в массив `ListData` (новые списки сверху). */
export function toListData(data: GuestData, guestName: string): ListData[] {
  return data.lists.map((list) => storedListToListData(list, data.groups, guestName));
}

// ---------------------------------------------------------------------------
// Гостевая реализация адаптера ListsApi
// ---------------------------------------------------------------------------

/**
 * Создаёт гостевую реализацию `ListsApi` поверх localStorage.
 *
 * Каждая операция: валидация (Zod) → мутация данных → запись в localStorage →
 * `refresh()`. Колбэк `refresh` перечитывает данные в состояние React —
 * это гостевой аналог `revalidatePath` на сервере: базовое состояние
 * `useOptimistic` в компонентах обновляется после каждой операции.
 *
 * @param refresh - Колбэк перезагрузки данных в состояние (из `GuestHome`).
 * @param guestName - Локализованное имя гостя (для `createList`).
 */
export function createGuestListsApi(refresh: () => void, guestName: string): ListsApi {
  /** Общий шаблон мутации: загрузка → изменение → сохранение → refresh. */
  function mutate(change: (data: GuestData) => { success: boolean; error?: string }): {
    success: boolean;
    error?: string;
  } {
    const data = loadGuestData();
    const result = change(data);
    if (!result.success) return result;

    if (!saveGuestData(data)) {
      return { success: false, error: "storageFailed" };
    }
    refresh();
    return result;
  }

  return {
    isGuest: true,

    // ---- Списки ----

    createList: async ({ title, groupId }) => {
      const parsed = createListSchema.safeParse({ title, groupId: groupId ?? undefined });
      if (!parsed.success) {
        return { success: false, error: getValidationError(parsed.error) };
      }

      const data = loadGuestData();
      const newList: StoredList = {
        id: guestId(),
        title: parsed.data.title,
        // Привязываем к группе сразу, если она существует (как на сервере)
        groupIds:
          parsed.data.groupId && data.groups.some((g) => g.id === parsed.data.groupId)
            ? [parsed.data.groupId]
            : [],
        items: [],
      };
      data.lists.unshift(newList); // Новые списки сверху (createdAt desc на сервере)

      if (!saveGuestData(data)) {
        return { success: false, error: "storageFailed" };
      }
      refresh();
      return { success: true, list: storedListToListData(newList, data.groups, guestName) };
    },

    renameList: async (listId, title) => {
      const parsed = renameListSchema.safeParse({ listId, title });
      if (!parsed.success) {
        return { success: false, error: getValidationError(parsed.error) };
      }
      return mutate((data) => {
        const list = data.lists.find((l) => l.id === parsed.data.listId);
        if (!list) return { success: false, error: "Список не найден" };
        list.title = parsed.data.title;
        return { success: true };
      });
    },

    deleteList: async (listId) => {
      return mutate((data) => {
        const before = data.lists.length;
        data.lists = data.lists.filter((l) => l.id !== listId);
        if (data.lists.length === before) {
          return { success: false, error: "Список не найден" };
        }
        return { success: true };
      });
    },

    // Расшаренных списков у гостя нет — операция недоступна по построению
    leaveSharedList: async () => ({ success: false, error: "Недоступно в гостевом режиме" }),

    // ---- Записи ----

    addItem: async (listId, itemName) => {
      const parsed = createItemSchema.safeParse({ listId, itemName });
      if (!parsed.success) {
        return { success: false, error: getValidationError(parsed.error) };
      }
      return mutate((data) => {
        const list = data.lists.find((l) => l.id === parsed.data.listId);
        if (!list) return { success: false, error: "Список не найден" };
        list.items.push({ id: guestId(), name: parsed.data.itemName, isCompleted: false });
        return { success: true };
      });
    },

    renameItem: async (itemId, itemName) => {
      const parsed = renameItemSchema.safeParse({ itemId, itemName });
      if (!parsed.success) {
        return { success: false, error: getValidationError(parsed.error) };
      }
      return mutate((data) => {
        const item = data.lists
          .flatMap((l) => l.items)
          .find((i) => i.id === parsed.data.itemId);
        if (!item) return { success: false, error: "Запись не найдена" };
        item.name = parsed.data.itemName;
        return { success: true };
      });
    },

    deleteItem: async (itemId) => {
      mutate((data) => {
        for (const list of data.lists) {
          list.items = list.items.filter((i) => i.id !== itemId);
        }
        return { success: true };
      });
    },

    toggleItem: async (itemId, isCompleted) => {
      mutate((data) => {
        const item = data.lists.flatMap((l) => l.items).find((i) => i.id === itemId);
        // Сохраняем инверсию ТЕКУЩЕГО значения — как в Server Action toggleItem
        if (item) item.isCompleted = !isCompleted;
        return { success: true };
      });
    },

    // ---- Группы ----

    createGroup: async (name) => {
      const parsed = createGroupSchema.safeParse({ name });
      if (!parsed.success) {
        return { success: false, error: getValidationError(parsed.error) };
      }

      const data = loadGuestData();
      const group = { id: guestId(), name: parsed.data.name };
      data.groups.push(group); // Порядок создания (createdAt asc на сервере)

      if (!saveGuestData(data)) {
        return { success: false, error: "storageFailed" };
      }
      refresh();
      return { success: true, group };
    },

    renameGroup: async (groupId, name) => {
      const parsed = renameGroupSchema.safeParse({ groupId, name });
      if (!parsed.success) {
        return { success: false, error: getValidationError(parsed.error) };
      }
      return mutate((data) => {
        const group = data.groups.find((g) => g.id === parsed.data.groupId);
        if (!group) return { success: false, error: "Группа не найдена" };
        group.name = parsed.data.name;
        return { success: true };
      });
    },

    deleteGroup: async (groupId) => {
      return mutate((data) => {
        const before = data.groups.length;
        data.groups = data.groups.filter((g) => g.id !== groupId);
        if (data.groups.length === before) {
          return { success: false, error: "Группа не найдена" };
        }
        // Списки не удаляются — только их связь с группой (как на сервере)
        for (const list of data.lists) {
          list.groupIds = list.groupIds.filter((id) => id !== groupId);
        }
        return { success: true };
      });
    },

    addListToGroup: async (listId, groupId) => {
      return mutate((data) => {
        const list = data.lists.find((l) => l.id === listId);
        if (!list || !data.groups.some((g) => g.id === groupId)) {
          return { success: false, error: "Список или группа не найдены" };
        }
        if (!list.groupIds.includes(groupId)) list.groupIds.push(groupId);
        return { success: true };
      });
    },

    removeListFromGroup: async (listId, groupId) => {
      return mutate((data) => {
        const list = data.lists.find((l) => l.id === listId);
        if (!list) return { success: false, error: "Список не найден" };
        list.groupIds = list.groupIds.filter((id) => id !== groupId);
        return { success: true };
      });
    },
  };
}
