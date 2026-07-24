/**
 * @file attachments.ts
 * @description Общие константы и чистые хелперы для фичи вложений.
 *
 * ВАЖНО: этот модуль безопасен для импорта и на сервере, и на клиенте —
 * здесь нет AWS SDK и нет секретов. Клиентский компонент загрузки берёт
 * отсюда лимиты и список форматов для UX-валидации, а серверный код —
 * для проверки факта (defense in depth). Сам S3-клиент с ключами живёт
 * отдельно в `s3.ts` и на клиент не попадает.
 */

/**
 * Категория файла — UI-концерн (иконка + группировка форматов).
 * Строковый литерал, а не Prisma-enum `FileCategory`: чтобы файл можно было
 * импортировать в клиентский бандл без затягивания `@prisma/client`.
 * Значения совпадают с enum в схеме — на сервере приводятся к нему как есть.
 */
export type FileCategoryValue = "IMAGE" | "DOCUMENT";

/** Потолок размера одного файла — 10 MB (в байтах). Дублирует S3-policy. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Квота: максимум файлов на один список. */
export const MAX_FILES_PER_LIST = 5;

/** Квота: максимум файлов на одного пользователя. */
export const MAX_FILES_PER_USER = 20;

/**
 * Возраст, после которого зависшая PENDING-строка считается мусором (минуты).
 * Реальная two-phase-загрузка укладывается в секунды, так что 15 минут —
 * заведомо больше любого живого in-flight и активную загрузку не заденет.
 * Используется ленивой уборкой в `requestUpload` (см. actions/attachments.ts).
 */
export const STALE_MINUTES = 15;

/**
 * Белый список разрешённых MIME-типов.
 * Ключ — реальный `contentType`, значение — категория (для UI) и расширение
 * (для object key в S3). Всё, чего нет в этой таблице, отбивается на загрузке.
 */
export const ALLOWED_TYPES: Record<
  string,
  { category: FileCategoryValue; ext: string }
> = {
  "image/png": { category: "IMAGE", ext: "png" },
  "image/jpeg": { category: "IMAGE", ext: "jpg" },
  "text/plain": { category: "DOCUMENT", ext: "txt" },
  "application/pdf": { category: "DOCUMENT", ext: "pdf" },
};

/**
 * Строка для атрибута `accept` у `<input type="file">`.
 * Ограничивает выбор в системном диалоге (UX, не безопасность).
 */
export const ACCEPT_ATTRIBUTE = Object.keys(ALLOWED_TYPES).join(",");

/**
 * Разрешён ли данный MIME-тип к загрузке.
 *
 * Именно `Object.hasOwn`, а не оператор `in`: `in` видит прототипную цепочку,
 * поэтому `contentType` вида "constructor" или "toString" проходил проверку.
 * Дальше по потоку `getCategory` возвращал для такого типа null, который
 * приведением `as FileCategory` выдавался за валидную категорию.
 */
export function isAllowedType(contentType: string): boolean {
  return Object.hasOwn(ALLOWED_TYPES, contentType);
}

/** Категория файла по MIME-типу (или null, если тип не разрешён). */
export function getCategory(contentType: string): FileCategoryValue | null {
  return ALLOWED_TYPES[contentType]?.category ?? null;
}

/** Расширение файла по MIME-типу (или null, если тип не разрешён). */
export function getExtension(contentType: string): string | null {
  return ALLOWED_TYPES[contentType]?.ext ?? null;
}

/**
 * Человекочитаемый размер файла (для UI): 1536 → "1.5 KB".
 * Без локализации — единицы измерения интернациональны.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
