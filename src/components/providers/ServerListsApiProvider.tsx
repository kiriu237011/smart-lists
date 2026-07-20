/**
 * @file ServerListsApiProvider.tsx
 * @description Серверная реализация адаптера `ListsApi` поверх Server Actions.
 *
 * Client Component (`"use client"`).
 *
 * Оборачивает существующие Server Actions в интерфейс `ListsApi`:
 *   - собирает FormData из обычных аргументов (раньше это делали компоненты);
 *   - добавляет socketId Pusher-соединения (`appendSocketId`), чтобы сервер
 *     исключил текущую вкладку из рассылки realtime-обновлений — вкладка-автор
 *     получает свежие данные вместе с ответом action (revalidatePath).
 *
 * Используется в `ListsDataFetcher` для авторизованных пользователей.
 */

"use client";

import { useMemo, type ReactNode } from "react";
import {
  addItem,
  deleteItem,
  toggleItem,
  renameItem,
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
import { appendSocketId } from "@/lib/pusher-client";
import { ListsApiProvider, type ListsApi } from "@/components/providers/ListsApiProvider";

/** Собирает FormData из пар «ключ-значение» и добавляет socketId Pusher. */
function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  appendSocketId(formData);
  return formData;
}

/** Провайдер серверного адаптера — данные сохраняются в БД через Server Actions. */
export default function ServerListsApiProvider({ children }: { children: ReactNode }) {
  // Адаптер стабилен между рендерами: все Server Actions — модульные ссылки.
  const api = useMemo<ListsApi>(
    () => ({
      isGuest: false,

      // ---- Списки ----
      createList: async ({ title, groupId }) => {
        const fields: Record<string, string> = { title };
        if (groupId) fields.groupId = groupId;
        return createList(buildFormData(fields));
      },
      renameList: async (listId, title) => renameList(buildFormData({ listId, title })),
      deleteList: async (listId) => deleteList(buildFormData({ listId })),
      leaveSharedList: async (listId) => leaveSharedList(buildFormData({ listId })),

      // ---- Записи ----
      addItem: async (listId, itemName) => addItem(buildFormData({ listId, itemName })),
      renameItem: async (itemId, itemName) => renameItem(buildFormData({ itemId, itemName })),
      deleteItem: async (itemId) => deleteItem(buildFormData({ itemId })),
      toggleItem: async (itemId, isCompleted) =>
        toggleItem(buildFormData({ itemId, isCompleted: isCompleted.toString() })),

      // ---- Группы ----
      createGroup: async (name) => createGroup(buildFormData({ name })),
      renameGroup: async (groupId, name) => renameGroup(buildFormData({ groupId, name })),
      deleteGroup: async (groupId) => deleteGroup(buildFormData({ groupId })),
      addListToGroup: async (listId, groupId) =>
        addListToGroup(buildFormData({ groupId, listId })),
      removeListFromGroup: async (listId, groupId) =>
        removeListFromGroup(buildFormData({ groupId, listId })),
    }),
    [],
  );

  return <ListsApiProvider api={api}>{children}</ListsApiProvider>;
}
