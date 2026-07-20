/**
 * @file ListsApiProvider.tsx
 * @description Слой-адаптер операций над списками (контекст + типы).
 *
 * Client Component (`"use client"`).
 *
 * Зачем нужен адаптер:
 *   Раньше клиентские компоненты (`ListsContainer`, `SmartList`) импортировали
 *   Server Actions напрямую и были жёстко привязаны к серверу/БД. Теперь все
 *   операции описаны единым интерфейсом `ListsApi`, у которого две реализации:
 *
 *   1. Серверная (`ServerListsApiProvider`) — оборачивает Server Actions,
 *      данные живут в PostgreSQL. Используется для авторизованных пользователей.
 *
 *   2. Гостевая (`createGuestListsApi` в `src/lib/guest-storage.ts`) —
 *      данные живут в localStorage браузера. Используется в гостевом режиме
 *      (вход без аккаунта).
 *
 * Компоненты получают реализацию через хук `useListsApi()` и не знают,
 * куда именно сохраняются данные. Формы результатов (`{ success, error }`)
 * полностью повторяют контракт существующих Server Actions, поэтому логика
 * оптимистичных обновлений в компонентах не меняется.
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ListData, ListGroup } from "@/components/lists/ListCard";

/** Базовый результат операции — контракт Server Actions. */
export type ActionResult = { success: boolean; error?: string };

/** Результат создания списка: при успехе содержит созданный список. */
export type CreateListResult = ActionResult & { list?: ListData };

/** Результат создания группы: при успехе содержит созданную группу. */
export type CreateGroupResult = ActionResult & { group?: ListGroup };

/**
 * Интерфейс операций над списками, записями и группами.
 * Сигнатуры принимают обычные аргументы (не FormData) — сборка FormData
 * для Server Actions инкапсулирована в серверной реализации.
 */
export type ListsApi = {
  /** true — гостевой режим (localStorage): скрываем шаринг/AI/вложения и Pusher. */
  isGuest: boolean;

  // ---- Списки ----
  createList: (input: { title: string; groupId?: string | null }) => Promise<CreateListResult>;
  renameList: (listId: string, title: string) => Promise<ActionResult>;
  deleteList: (listId: string) => Promise<ActionResult>;
  leaveSharedList: (listId: string) => Promise<ActionResult>;

  // ---- Записи ----
  addItem: (listId: string, itemName: string) => Promise<ActionResult>;
  renameItem: (itemId: string, itemName: string) => Promise<ActionResult>;
  deleteItem: (itemId: string) => Promise<void>;
  toggleItem: (itemId: string, isCompleted: boolean) => Promise<void>;

  // ---- Группы ----
  createGroup: (name: string) => Promise<CreateGroupResult>;
  renameGroup: (groupId: string, name: string) => Promise<ActionResult>;
  deleteGroup: (groupId: string) => Promise<ActionResult>;
  addListToGroup: (listId: string, groupId: string) => Promise<ActionResult>;
  removeListFromGroup: (listId: string, groupId: string) => Promise<ActionResult>;
};

const ListsApiContext = createContext<ListsApi | null>(null);

/** Провайдер адаптера: реализация передаётся сверху (серверная или гостевая). */
export function ListsApiProvider({
  api,
  children,
}: {
  api: ListsApi;
  children: ReactNode;
}) {
  return <ListsApiContext.Provider value={api}>{children}</ListsApiContext.Provider>;
}

/**
 * Хук доступа к адаптеру операций.
 * Бросает ошибку вне провайдера — это ошибка композиции, а не рантайма.
 */
export function useListsApi(): ListsApi {
  const api = useContext(ListsApiContext);
  if (!api) {
    throw new Error("useListsApi вызван вне ListsApiProvider");
  }
  return api;
}
