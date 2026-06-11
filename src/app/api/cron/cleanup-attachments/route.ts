/**
 * @file route.ts
 * @description Крон-эндпоинт уборки зависших PENDING-вложений.
 *
 * Вызывается по расписанию (GitHub Actions, см. .github/workflows/cleanup-attachments.yml).
 * Удаляет строки Attachment в статусе PENDING старше ~15 минут — это делает
 * двойную работу: чистит мусор И освобождает квоту пользователя/списка.
 *
 * Защита: запрос должен нести заголовок `Authorization: Bearer <ATTACHMENTS_CRON_SECRET>`.
 * Без сессии NextAuth — это server-to-server вызов, не пользовательский.
 *
 * S3-сироты (PENDING, чей файл всё же залился, но confirm не пришёл) в v1
 * принимаются как редкий допустимый риск (HeadObject отсекает большинство на
 * confirm). Авто-уборка объектов через S3 lifecycle — отложенный крюк на будущее.
 */

import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

/** Возраст, после которого PENDING-строка считается зависшей (минуты). */
const STALE_MINUTES = 15;

/**
 * Сравнение строк за постоянное время — защита от timing-атаки на секрет.
 * Сначала сверяем длину (timingSafeEqual бросает при разной длине буферов).
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  // Проверка shared secret — это не пользовательский, а server-to-server вызов.
  const secret = process.env.ATTACHMENTS_CRON_SECRET;
  if (!secret) {
    logger.error({ action: "cleanupAttachments" }, "ATTACHMENTS_CRON_SECRET не задан");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!safeEqual(authHeader, `Bearer ${secret}`)) {
    logger.warn({ action: "cleanupAttachments" }, "Неавторизованный вызов крон-уборки");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Порог: всё, что создано раньше (now - STALE_MINUTES), считается зависшим.
  const threshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

  const deleted = await prisma.attachment.deleteMany({
    where: {
      status: "PENDING",
      createdAt: { lt: threshold },
    },
  });

  logger.info(
    { count: deleted.count, action: "cleanupAttachments" },
    "Крон уборки PENDING-вложений выполнен",
  );

  return NextResponse.json({ success: true, deleted: deleted.count });
}
