/**
 * @file attachments.ts
 * @description Server Actions для фичи вложений к спискам (S3).
 *
 * Поток загрузки — two-phase, чтобы недозалитый файл не светился в UI:
 *   1. `requestUpload`  — проверка прав + квоты, создание PENDING-строки,
 *                         выдача presigned POST. Байты идут НЕ через нас.
 *   2. клиент           — POST файла напрямую в S3 (см. AttachmentUploader).
 *   3. `confirmUpload`  — HeadObject подтверждает факт + реальный размер,
 *                         статус становится UPLOADED.
 *
 * Безопасность (как в остальных actions):
 *   - membership-проверка по сессии на каждое действие (защита от IDOR);
 *   - данные о доступе берутся из БД, не от клиента;
 *   - квота на список считается под row-lock на строке List (защита от TOCTOU).
 */

"use server";

import { auth } from "@/auth";
import prisma from "@/lib/db";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { logger, hashId } from "@/lib/logger";
import { notifyListMembers } from "@/lib/notify";
import { listInSpaceWhere } from "@/lib/spaces";
import {
  requestUploadSchema,
  confirmUploadSchema,
  deleteAttachmentSchema,
  getAttachmentUrlSchema,
} from "@/lib/validations";
import {
  MAX_FILE_SIZE,
  MAX_FILES_PER_LIST,
  MAX_FILES_PER_USER,
  STALE_MINUTES,
  getCategory,
  isAllowedType,
} from "@/lib/attachments";
import {
  buildAttachmentKey,
  createUploadPost,
  headObject,
  getDownloadUrl,
  deleteObject,
  isS3Configured,
} from "@/lib/s3";
import type { FileCategory } from "@prisma/client";

/** Результат запроса на загрузку: данные для прямого POST в S3. */
interface RequestUploadResult {
  success: boolean;
  error?: string;
  upload?: {
    /** URL бакета, куда слать multipart/form-data. */
    url: string;
    /** Поля формы из presigned POST (добавляются перед файлом). */
    fields: Record<string, string>;
    /** ID созданной PENDING-строки — нужен для confirm. */
    attachmentId: string;
  };
}

/**
 * Шаг 1 — запросить загрузку файла.
 *
 * Проверяет авторизацию, доступ к списку и квоты, создаёт PENDING-строку
 * вложения и возвращает presigned POST для прямой заливки в S3.
 *
 * @param input - `{ listId, fileName, contentType, size }` (size/contentType —
 *                заявленные клиентом, реальные проверит S3 + HeadObject).
 * @returns `{ success, upload? , error? }`. Коды ошибок переводятся на клиенте.
 */
export async function requestUpload(input: {
  listId: string;
  spaceId: string;
  fileName: string;
  contentType: string;
  size: number;
}): Promise<RequestUploadResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "unauthorized" };
    }

    // S3 не настроен — нет смысла создавать PENDING-строку, которую некуда залить.
    if (!isS3Configured()) {
      logger.error({ action: "requestUpload" }, "S3 не сконфигурирован (env)");
      return { success: false, error: "uploadError" };
    }

    const result = requestUploadSchema.safeParse(input);
    if (!result.success) {
      return { success: false, error: "validationError" };
    }
    const { listId, fileName, contentType, size } = result.data;

    // Тип файла — по белому списку (png/jpeg/txt/pdf). Это ранний отсев;
    // окончательно тип закрепляет S3-policy (eq $Content-Type).
    if (!isAllowedType(contentType)) {
      return { success: false, error: "invalidFileType" };
    }
    const category = getCategory(contentType) as FileCategory;

    // Object key генерируем сами — исключает коллизии и path-traversal.
    const key = buildAttachmentKey(listId, contentType);
    if (!key) {
      return { success: false, error: "invalidFileType" };
    }

    const userId = session.user.id;

    // --- Транзакция с row-lock: проверка квоты без гонок (TOCTOU) ---
    // Лочим строку List (SELECT ... FOR UPDATE): параллельные запросы на тот же
    // список выстраиваются в очередь и видят актуальный COUNT, а не одинаковый
    // устаревший. Тот же приём, что у AiInsightUsage.
    const txResult = await prisma.$transaction(async (tx) => {
      // Лок + проверка существования списка
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "List" WHERE id = ${listId} FOR UPDATE`;
      if (locked.length === 0) {
        return { error: "listNotFound" as const };
      }

      // Membership: владелец или пользователь из sharedWith
      const list = await tx.list.findFirst({
        where: {
          id: listId,
          ...listInSpaceWhere(userId, input.spaceId),
        },
        select: { id: true },
      });
      if (!list) {
        return { error: "listNotFound" as const };
      }

      // Ленивая уборка зависших PENDING — вместо внешнего крона. Чистим ровно
      // те два измерения квоты, что проверим ниже (этот список и этот юзер):
      // так квота освобождается ровно тогда, когда на неё есть давление.
      // Под List-локом → списочная квота без гонок; deleteMany атомарен и
      // идемпотентен, поэтому пересечение по юзеру с параллельным запросом
      // (другой список того же юзера) безвредно.
      const threshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000);
      const cleaned = await tx.attachment.deleteMany({
        where: {
          status: "PENDING",
          createdAt: { lt: threshold },
          OR: [{ listId }, { uploadedById: userId }],
        },
      });
      if (cleaned.count > 0) {
        logger.info(
          { count: cleaned.count, listId, action: "requestUpload" },
          "Прибраны зависшие PENDING-вложения (ленивая уборка)",
        );
      }

      // Квота на список: считаем PENDING + UPLOADED (иначе обход через пачку
      // запросов «всё PENDING — ничего не в счёт»).
      const listCount = await tx.attachment.count({ where: { listId } });
      if (listCount >= MAX_FILES_PER_LIST) {
        return { error: "listQuotaExceeded" as const };
      }

      // Квота на пользователя — без отдельного лока (ставки низкие, см. доку).
      const userCount = await tx.attachment.count({
        where: { uploadedById: userId },
      });
      if (userCount >= MAX_FILES_PER_USER) {
        return { error: "userQuotaExceeded" as const };
      }

      // Создаём PENDING-строку. size здесь — заявленный; реальный перезапишем
      // на confirm после HeadObject.
      const attachment = await tx.attachment.create({
        data: {
          key,
          name: fileName,
          type: category,
          contentType,
          size,
          status: "PENDING",
          listId,
          uploadedById: userId,
        },
        select: { id: true },
      });
      return { attachmentId: attachment.id };
    });

    if ("error" in txResult) {
      return { success: false, error: txResult.error };
    }

    // Presigned POST генерим вне транзакции (это сетевой вызов к AWS, не БД).
    const { url, fields } = await createUploadPost({
      key,
      contentType,
      maxSize: MAX_FILE_SIZE,
    });

    logger.info(
      {
        uid: hashId(userId),
        listId,
        attachmentId: txResult.attachmentId,
        action: "requestUpload",
      },
      "Запрошена загрузка вложения",
    );

    return {
      success: true,
      upload: { url, fields, attachmentId: txResult.attachmentId },
    };
  } catch (error) {
    logger.error({ error }, "Ошибка при запросе загрузки вложения:");
    return { success: false, error: "uploadError" };
  }
}

/**
 * Шаг 3 — подтвердить загрузку.
 *
 * Вызывается клиентом после успешного ответа S3. Не доверяем слову клиента:
 * HeadObject проверяет, что файл действительно в S3, и даёт честный размер.
 * Только после этого строка переходит в UPLOADED и становится видимой в UI.
 *
 * При любом обломе строка остаётся PENDING — её приберёт крон (квота
 * временно занята, но это самоблокировка юзера, не дыра).
 *
 * @param input - `{ attachmentId }` созданной на шаге 1 PENDING-строки.
 */
export async function confirmUpload(input: {
  attachmentId: string;
  spaceId: string;
  socketId?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "unauthorized" };
    }
    const userId = session.user.id;

    const result = confirmUploadSchema.safeParse(input);
    if (!result.success) {
      return { success: false, error: "validationError" };
    }

    // Membership-проверка + берём только PENDING-строку (идемпотентность:
    // повторный confirm на уже UPLOADED ничего не найдёт и не навредит).
    const attachment = await prisma.attachment.findFirst({
      where: {
        id: result.data.attachmentId,
        status: "PENDING",
        list: {
          ...listInSpaceWhere(userId, input.spaceId),
        },
      },
      select: { id: true, key: true, listId: true },
    });
    if (!attachment) {
      return { success: false, error: "attachmentNotFound" };
    }

    // HeadObject — доказательство факта загрузки и реальный размер/тип.
    const head = await headObject(attachment.key);
    if (!head) {
      // Файла в S3 нет (клиент соврал или загрузка сорвалась) — оставляем PENDING.
      return { success: false, error: "uploadNotFound" };
    }

    // Валидация ФАКТИЧЕСКИХ размера и типа (не заявленных клиентом).
    if (
      head.contentLength <= 0 ||
      head.contentLength > MAX_FILE_SIZE ||
      !isAllowedType(head.contentType)
    ) {
      logger.warn(
        {
          uid: hashId(userId),
          attachmentId: attachment.id,
          size: head.contentLength,
          contentType: head.contentType,
          action: "confirmUpload",
        },
        "Фактический файл не прошёл валидацию",
      );
      return { success: false, error: "invalidFileType" };
    }

    // status = UPLOADED + реальный размер. updateMany c status=PENDING в where
    // делает переход атомарным и идемпотентным.
    const updated = await prisma.attachment.updateMany({
      where: { id: attachment.id, status: "PENDING" },
      data: { status: "UPLOADED", size: head.contentLength },
    });
    if (updated.count === 0) {
      return { success: false, error: "attachmentNotFound" };
    }

    revalidatePath("/", "layout");
    // Уведомление после ответа (after), без эха вкладке автора (socketId)
    after(() => notifyListMembers(attachment.listId, result.data.socketId));
    logger.info(
      {
        uid: hashId(userId),
        listId: attachment.listId,
        attachmentId: attachment.id,
        action: "confirmUpload",
      },
      "Загрузка вложения подтверждена",
    );
    return { success: true };
  } catch (error) {
    logger.error({ error }, "Ошибка при подтверждении загрузки вложения:");
    return { success: false, error: "uploadError" };
  }
}

/**
 * Удаляет вложение. Доступно любому участнику списка (не только загрузившему) —
 * переиспользуется тот же membership-чек, закрывая IDOR.
 *
 * Порядок: сначала БД, потом S3 (best-effort). Если S3-удаление упадёт,
 * останется невидимый сирота — это дешевле, чем битая ссылка в UI.
 *
 * @param input - `{ attachmentId }`.
 */
export async function deleteAttachment(input: {
  attachmentId: string;
  spaceId: string;
  socketId?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "unauthorized" };
    }
    const userId = session.user.id;

    const result = deleteAttachmentSchema.safeParse(input);
    if (!result.success) {
      return { success: false, error: "validationError" };
    }

    // Membership-проверка + забираем key/listId до удаления строки.
    const attachment = await prisma.attachment.findFirst({
      where: {
        id: result.data.attachmentId,
        list: {
          ...listInSpaceWhere(userId, input.spaceId),
        },
      },
      select: { id: true, key: true, listId: true },
    });
    if (!attachment) {
      return { success: false, error: "attachmentNotFound" };
    }

    // Сначала БД — UI сразу чист.
    await prisma.attachment.delete({ where: { id: attachment.id } });

    // Потом S3 — best-effort: сбой логируем, но не валим операцию.
    try {
      await deleteObject(attachment.key);
    } catch (s3Error) {
      logger.error(
        { error: s3Error, key: attachment.key, action: "deleteAttachment" },
        "Не удалось удалить объект из S3 (осиротевший файл)",
      );
    }

    revalidatePath("/", "layout");
    // Уведомление после ответа (after), без эха вкладке автора (socketId)
    after(() => notifyListMembers(attachment.listId, result.data.socketId));
    logger.info(
      {
        uid: hashId(userId),
        listId: attachment.listId,
        attachmentId: attachment.id,
        action: "deleteAttachment",
      },
      "Вложение удалено",
    );
    return { success: true };
  } catch (error) {
    logger.error({ error }, "Ошибка при удалении вложения:");
    return { success: false, error: "deleteError" };
  }
}

/**
 * Выдаёт presigned GET-ссылку на скачивание/просмотр вложения.
 * Bucket приватный — это единственный способ отдать файл. TTL короткий.
 *
 * @param input - `{ attachmentId, download? }`.
 * @returns `{ success, url? , error? }`.
 */
export async function getAttachmentUrl(input: {
  attachmentId: string;
  spaceId: string;
  download?: boolean;
}): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return { success: false, error: "unauthorized" };
    }
    const userId = session.user.id;

    const result = getAttachmentUrlSchema.safeParse(input);
    if (!result.success) {
      return { success: false, error: "validationError" };
    }

    // Membership + только UPLOADED (PENDING-файла в S3 может ещё не быть).
    const attachment = await prisma.attachment.findFirst({
      where: {
        id: result.data.attachmentId,
        status: "UPLOADED",
        list: {
          ...listInSpaceWhere(userId, input.spaceId),
        },
      },
      select: { key: true, name: true },
    });
    if (!attachment) {
      return { success: false, error: "attachmentNotFound" };
    }

    const url = await getDownloadUrl(
      attachment.key,
      attachment.name,
      result.data.download ?? false,
    );
    return { success: true, url };
  } catch (error) {
    logger.error({ error }, "Ошибка при выдаче ссылки на вложение:");
    return { success: false, error: "downloadError" };
  }
}
