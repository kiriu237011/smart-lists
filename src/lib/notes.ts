/**
 * @file notes.ts
 * @description Общие ограничения и чистые хелперы текстовых заметок.
 *
 * Модуль безопасен для импорта на клиенте и сервере: здесь нет Prisma,
 * секретов или браузерных API. Одни и те же лимиты используются UI,
 * Zod-валидацией и формированием контекста AI.
 */

/** Максимальная длина одной заметки списка или записи. */
export const MAX_NOTE_LENGTH = 4000;

/**
 * Максимальное количество пунктов ВЕРХНЕГО УРОВНЯ в одном AI-инсайте.
 *
 * Считаются именно пункты: подпункты едут вместе со своим пунктом и на этот
 * лимит не влияют. Иначе один длинный блок вытеснял бы из контекста половину
 * списка, и смысл ограничения менялся бы от списка к списку.
 */
export const MAX_INSIGHT_ITEMS = 50;

/**
 * Максимальное количество подпунктов в одном AI-инсайте — суммарно по всему
 * списку. Отдельный бюджет: пунктов не больше пятидесяти, а подпунктов у них
 * может быть сколько угодно, и без потолка размер запроса ничем не ограничен.
 */
export const MAX_INSIGHT_SUB_ITEMS = 100;

/**
 * Максимальное количество групп списка в одном AI-инсайте.
 *
 * Совпадает с лимитом AI-сервиса. Обрезать обязательно: групп в пространстве
 * бывает до `MAX_GROUPS_PER_SPACE`, и список теоретически входит в любое их
 * число — превышение отбраковало бы Pydantic целиком, а не лишние элементы,
 * то есть инсайт не построился бы вовсе.
 */
export const MAX_INSIGHT_GROUPS = 20;

/** Максимальная длина названия одной группы в контексте AI. */
export const MAX_INSIGHT_GROUP_NAME_LENGTH = 100;

/** Максимальное количество заметок записей в одном AI-инсайте. */
export const MAX_INSIGHT_ITEM_NOTES = 10;

/** Суммарный символьный бюджет заметок записей в одном AI-инсайте. */
export const MAX_INSIGHT_ITEM_NOTES_CHARS = 8000;

/** Превращает пустую/пробельную заметку в null, сохраняя переносы внутри текста. */
export function normalizeNote(note: string): string | null {
  const normalized = note.replace(/\r\n?/g, "\n").trim();
  return normalized || null;
}

/**
 * Возвращает короткий фрагмент заметки вокруг поискового совпадения.
 * Нужен, чтобы пользователь видел причину попадания списка в результаты поиска.
 */
export function getNoteExcerpt(note: string, query: string, maxLength = 160): string {
  const compact = note.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;

  const matchIndex = compact.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
  if (matchIndex < 0) return `${compact.slice(0, maxLength - 1)}…`;

  const radius = Math.floor((maxLength - 2) / 2);
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(compact.length, start + maxLength - 2);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
}
