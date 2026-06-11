/**
 * @file s3.ts
 * @description Серверный S3-клиент и хелперы для работы с вложениями.
 *
 * ВНИМАНИЕ: модуль читает секретные AWS-ключи из env и НЕ должен импортироваться
 * в клиентские компоненты (`"use client"`). Использовать только из Server Actions.
 *
 * Архитектурный принцип фичи — клиент грузит байты напрямую в S3 по presigned
 * POST, минуя serverless-функцию. Здесь же — генерация presigned URL, проверка
 * факта загрузки (HeadObject) и удаление объектов.
 *
 * Все хелперы адресуют объекты по object key (`lists/{listId}/{uuid}.ext`),
 * а не по полному URL: key стабилен, URL завязан на bucket/регион и протухает.
 */

import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  createPresignedPost,
  type PresignedPost,
} from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { getExtension } from "@/lib/attachments";

// ---------------------------------------------------------------------------
// Конфигурация из env
// ---------------------------------------------------------------------------

/**
 * Имя бакета. Читаем один раз при загрузке модуля.
 * Если переменные не заданы — клиент всё равно создаётся, но запросы упадут;
 * каждый Server Action логирует ошибку и возвращает понятный результат.
 */
const BUCKET = process.env.S3_BUCKET_NAME ?? "";
const REGION = process.env.S3_REGION ?? "";

/** Срок жизни presigned-ссылок (секунды). Коротко — это разовый доступ. */
const PRESIGN_TTL = 300; // 5 минут

/**
 * Единственный экземпляр S3Client.
 * Ключи передаём явно (а не через авто-обнаружение SDK) — это развязывает нас
 * от зарезервированных `AWS_*`-имён на платформах вроде Vercel.
 */
const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
});

/** Заданы ли все обязательные переменные окружения для S3. */
export function isS3Configured(): boolean {
  return Boolean(
    BUCKET &&
      REGION &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

// ---------------------------------------------------------------------------
// Генерация object key
// ---------------------------------------------------------------------------

/**
 * Строит object key по схеме `lists/{listId}/{uuid}.ext`.
 * Имя файла генерируем сами (UUID) — это исключает коллизии, юникод-сюрпризы
 * и path-traversal из пользовательского имени.
 *
 * @returns key или null, если MIME-тип не разрешён (нет расширения).
 */
export function buildAttachmentKey(
  listId: string,
  contentType: string,
): string | null {
  const ext = getExtension(contentType);
  if (!ext) return null;
  return `lists/${listId}/${randomUUID()}.${ext}`;
}

// ---------------------------------------------------------------------------
// Presigned POST (загрузка: клиент → S3 напрямую)
// ---------------------------------------------------------------------------

/**
 * Генерирует presigned POST для прямой загрузки файла в S3.
 *
 * В policy зашиты условия, которые S3 проверяет ДО сохранения:
 *   - `content-length-range` — потолок размера (файл вне диапазона → 400);
 *   - `eq $Content-Type` — ровно тот тип, что мы разрешили.
 *
 * Именно POST (а не PUT): только он умеет ограничить размер на стороне S3.
 *
 * @returns `{ url, fields }` — клиент шлёт multipart/form-data на `url`
 *          с этими `fields` + самим файлом в поле `file` (последним).
 */
export function createUploadPost(params: {
  key: string;
  contentType: string;
  maxSize: number;
}): Promise<PresignedPost> {
  return createPresignedPost(s3Client, {
    Bucket: BUCKET,
    Key: params.key,
    Conditions: [
      ["content-length-range", 1, params.maxSize],
      ["eq", "$Content-Type", params.contentType],
    ],
    Fields: {
      "Content-Type": params.contentType,
    },
    Expires: PRESIGN_TTL,
  });
}

// ---------------------------------------------------------------------------
// HeadObject (подтверждение: проверяем факт + реальный размер)
// ---------------------------------------------------------------------------

/** Метаданные объекта из HeadObject. */
export interface ObjectHead {
  contentLength: number;
  contentType: string;
}

/**
 * Запрашивает метаданные объекта (HeadObject).
 * Используется на confirm: подтверждение клиента — это его слово, а HeadObject
 * даёт факт наличия и честный размер.
 *
 * @returns метаданные или null, если объекта нет / запрос упал.
 */
export async function headObject(key: string): Promise<ObjectHead | null> {
  try {
    const res = await s3Client.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
    );
    return {
      contentLength: res.ContentLength ?? 0,
      contentType: res.ContentType ?? "",
    };
  } catch {
    // Объект не найден (404) или иная ошибка — для вызывающего это «не залилось».
    return null;
  }
}

// ---------------------------------------------------------------------------
// Presigned GET (скачивание/просмотр)
// ---------------------------------------------------------------------------

/**
 * Генерирует presigned GET URL с коротким TTL.
 * Bucket приватный — прямых публичных ссылок нет, отдаём только так.
 *
 * @param key      object key в S3.
 * @param fileName оригинальное имя — для заголовка Content-Disposition.
 * @param download true → форсировать скачивание (attachment), false → инлайн-просмотр.
 */
export function getDownloadUrl(
  key: string,
  fileName: string,
  download = false,
): Promise<string> {
  // encodeURIComponent защищает заголовок от спецсимволов/юникода в имени файла.
  const disposition = `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ResponseContentDisposition: disposition,
  });
  return getSignedUrl(s3Client, command, { expiresIn: PRESIGN_TTL });
}

// ---------------------------------------------------------------------------
// Удаление объектов
// ---------------------------------------------------------------------------

/**
 * Удаляет один объект из S3.
 * Бросает при ошибке — вызывающий решает, делать ли это best-effort.
 */
export async function deleteObject(key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Батч-удаление объектов (до 1000 ключей за вызов — лимит S3 DeleteObjects).
 * Используется при удалении списка: ключи читаются до каскада, затем сносятся.
 * Пустой массив — no-op (S3 не принимает пустой Delete).
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await s3Client.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
}
