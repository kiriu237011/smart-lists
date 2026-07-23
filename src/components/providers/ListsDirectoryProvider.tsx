/**
 * @file ListsDirectoryProvider.tsx
 * @description Справочник списков пространства для операций «между списками».
 *
 * Client Component (`"use client"`).
 *
 * Зачем отдельный контекст, а не пропсы:
 *   `SmartList` знает только свои записи и свой `listId` — этого достаточно
 *   для всех операций внутри списка. Перенос записи в другой список требует
 *   знания обо ВСЕХ списках пространства, а путь до него идёт через `ListCard`,
 *   который обёрнут в `memo`. Новый массив пропом на каждый рендер сбрасывал бы
 *   мемоизацию всех карточек разом, поэтому справочник приходит контекстом:
 *   `ListCard` его не видит вовсе, а берёт `SmartList` напрямую.
 *
 * Важно: справочник строится по ПОЛНОМУ набору списков, а не по отфильтрованному.
 * Иначе при активном фильтре группы или поиске часть списков исчезала бы из
 * выбора — хотя перенести запись туда по-прежнему можно.
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ListGroup } from "@/components/lists/ListCard";

/** Список как цель переноса: минимум полей, нужных пикеру. */
export type ListDirectoryEntry = {
  id: string;
  title: string;
  /** ID личных групп пользователя, в которых лежит список. */
  groupIds: string[];
  /**
   * Список виден кому-то ещё: он расшарен пользователем или получен по share.
   * Пикер помечает такие списки — перенос записи туда открывает её заметку
   * остальным участникам, и это не должно быть сюрпризом.
   */
  isShared: boolean;
};

/** Содержимое контекста: списки-цели и личные группы для фильтра. */
export type ListsDirectory = {
  lists: ListDirectoryEntry[];
  groups: ListGroup[];
};

const EMPTY_DIRECTORY: ListsDirectory = { lists: [], groups: [] };

const ListsDirectoryContext = createContext<ListsDirectory>(EMPTY_DIRECTORY);

/** Провайдер справочника. Значение собирается в `ListsContainer` через useMemo. */
export function ListsDirectoryProvider({
  directory,
  children,
}: {
  directory: ListsDirectory;
  children: ReactNode;
}) {
  return (
    <ListsDirectoryContext.Provider value={directory}>
      {children}
    </ListsDirectoryContext.Provider>
  );
}

/**
 * Хук доступа к справочнику.
 *
 * Вне провайдера возвращает пустой справочник, а не бросает ошибку: отсутствие
 * других списков — легальное состояние (единственный список у пользователя),
 * и UI его уже обрабатывает пустым состоянием пикера.
 */
export function useListsDirectory(): ListsDirectory {
  return useContext(ListsDirectoryContext);
}
