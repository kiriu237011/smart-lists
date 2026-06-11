/**
 * @file notify.ts
 * @description Хелперы real-time уведомлений участников списка через Pusher.
 *
 * Вынесены в отдельный модуль (а не в actions), чтобы переиспользоваться из
 * нескольких файлов Server Actions без превращения в публичные actions.
 *
 * Общий принцип: сбой уведомления НЕ откатывает уже успешную мутацию в БД —
 * ошибки логируются, но наружу не пробрасываются.
 */

import prisma from "@/lib/db";
import { pusherServer } from "@/lib/pusher-server";
import { logger } from "@/lib/logger";

/**
 * Находит всех пользователей с доступом к списку (владелец + sharedWith)
 * и отправляет им событие refresh.
 */
export async function notifyListMembers(listId: string) {
  try {
    const list = await prisma.list.findUnique({
      where: { id: listId },
      select: {
        ownerId: true,
        sharedWith: { select: { id: true } },
      },
    });

    if (!list) return;

    const userIds = [list.ownerId, ...list.sharedWith.map((u) => u.id)];

    await notifyUsers(userIds);
  } catch (err) {
    logger.error({ error: err }, "notifyListMembers failed:");
  }
}

/**
 * Отправляет refresh в личные private-каналы пользователей.
 * Ошибка Pusher логируется, но не ломает уже завершённую мутацию.
 */
export async function notifyUsers(userIds: string[]) {
  // Каждому пользователю — свой private-канал.
  // private-* каналы требуют прохождения auth endpoint (/api/pusher/auth),
  // который проверяет, что клиент подписывается только на свой канал.
  // .catch не пробрасывает ошибку наружу — сбой Pusher не откатывает мутацию в БД.
  await Promise.all(
    userIds.map((userId) =>
      pusherServer.trigger(`private-user-${userId}`, "refresh", {}),
    ),
  ).catch((err) => logger.error("Pusher notify failed:", err));
}
