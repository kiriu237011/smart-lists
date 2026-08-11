/**
 * @file CollapsedItemsProvider.tsx
 * @description Свёрнутые блоки подпунктов: набор ID и переключение.
 *
 * Client Component (`"use client"`).
 *
 * Значение доставляется контекстом, а не пропсом, по той же причине, что и
 * справочник списков: путь до `SmartList` идёт через обёрнутый в `memo`
 * `ListCard`, и пропс сбрасывал бы мемоизацию всех карточек при сворачивании
 * одного блока. Контекст перерисовывает только тех, кто его читает, — то есть
 * сами `SmartList`, которым перерисовка и нужна.
 *
 * Хранилищем и уборкой исчезнувших ID занимается `ListsContainer`: только он
 * видит все списки пространства сразу. Здесь — лишь передача.
 */

"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Контракт: набор свёрнутых пунктов и переключение одного из них. */
export type CollapsedItems = {
  /**
   * ID пунктов, свёрнутых пользователем вручную.
   *
   * Выполненные блоки сворачиваются сами и в этот набор не попадают: их
   * состояние выводится из отметки, а разворот живёт до перезагрузки —
   * см. `SmartList`.
   */
  collapsedIds: Set<string>;
  /** Сворачивает или разворачивает блок и сохраняет выбор. */
  toggle: (itemId: string) => void;
};

const CollapsedItemsContext = createContext<CollapsedItems | null>(null);

export function CollapsedItemsProvider({
  value,
  children,
}: {
  value: CollapsedItems;
  children: ReactNode;
}) {
  return (
    <CollapsedItemsContext.Provider value={value}>
      {children}
    </CollapsedItemsContext.Provider>
  );
}

/**
 * Доступ к свёрнутым блокам.
 *
 * Бросает ошибку вне провайдера — это ошибка композиции, а не рантайма.
 */
export function useCollapsedItems(): CollapsedItems {
  const value = useContext(CollapsedItemsContext);
  if (!value) {
    throw new Error("useCollapsedItems вызван вне CollapsedItemsProvider");
  }
  return value;
}
