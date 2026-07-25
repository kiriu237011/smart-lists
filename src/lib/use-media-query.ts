/**
 * @file use-media-query.ts
 * @description Подписка на медиа-запрос.
 *
 * Клиентский хук: на сервере ни ширины экрана, ни типа указателя не существует,
 * поэтому серверный снимок всегда `false`. Из этого следует правило — верстку
 * по возможности решает CSS, а хук берут только там, где CSS сам не справляется
 * и где неверный первый кадр картину не портит.
 */

"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Совпадает ли медиа-запрос прямо сейчас.
 *
 * @param query - Строка медиа-запроса.
 * @returns До гидрации всегда `false`, дальше — актуальное значение.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
