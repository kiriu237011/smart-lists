/**
 * @file collapsed-lists.ts
 * @description Набор свёрнутых карточек списков в localStorage.
 *
 * Клиентский модуль (значение читает и пишет `ListsContainer`).
 *
 * Свёрнутость — персональная настройка отображения на устройство, а не свойство
 * списка: она не попадает в БД и не видна другим участникам расшаренного
 * списка. Поэтому набор живёт в localStorage, ключ — на пространство
 * (`collapsedLists:<spaceId>`, у гостя `guest:collapsedLists`), как и ID
 * активной группы.
 *
 * Хранится JSON-массив ID. Разбор намеренно терпимый: в localStorage может
 * лежать что угодно — значение от прошлой версии формата, обрезанная строка,
 * правка из консоли. Любое непонятное значение считается пустым набором:
 * потеря настройки отображения безобиднее, чем исключение при гидрации,
 * которое уронило бы весь контейнер списков.
 */

/**
 * Разбирает сохранённое значение в набор ID.
 *
 * Нестроковые элементы отбрасываются поштучно: один мусорный элемент не должен
 * стирать остальные, иначе одна ручная правка ключа сбрасывала бы все свёрнутые
 * карточки сразу.
 *
 * @param raw - Значение из localStorage; null, если ключа нет.
 */
export function parseCollapsedLists(raw: string | null): Set<string> {
  if (!raw) return new Set();

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();

    return new Set(
      parsed.filter((id): id is string => typeof id === "string" && id !== ""),
    );
  } catch {
    return new Set();
  }
}

/** Сериализует набор для записи в localStorage. */
export function serializeCollapsedLists(ids: Set<string>): string {
  return JSON.stringify([...ids]);
}

/**
 * Добавляет ID в набор или убирает его оттуда.
 *
 * Возвращает новый набор, не мутируя исходный: значение лежит в состоянии React
 * и должно меняться иммутабельно.
 */
export function toggleCollapsedList(
  ids: Set<string>,
  listId: string,
): Set<string> {
  const next = new Set(ids);
  if (!next.delete(listId)) next.add(listId);
  return next;
}

/**
 * Отсеивает ID списков, которых больше нет.
 *
 * Без этого набор растёт вечно: удалённый список исчезает из выборки, а его ID
 * остаётся в localStorage навсегда. Ключ привязан к пространству, поэтому
 * сравнение с текущей выборкой безопасно — чужие ID в него не попадают.
 *
 * Возвращает исходный набор без изменений, если отсеивать нечего: вызывающий
 * по этому признаку решает, нужна ли запись в localStorage.
 */
export function pruneCollapsedLists(
  ids: Set<string>,
  existingIds: Iterable<string>,
): Set<string> {
  if (ids.size === 0) return ids;

  const existing = new Set(existingIds);
  const kept = new Set([...ids].filter((id) => existing.has(id)));
  return kept.size === ids.size ? ids : kept;
}
