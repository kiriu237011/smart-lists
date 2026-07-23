/**
 * @file notify.ts
 * @description Хелперы real-time уведомлений участников списка через Pusher.
 *
 * Вынесены в отдельный модуль (а не в actions), чтобы переиспользоваться из
 * нескольких файлов Server Actions без превращения в публичные actions.
 *
 * Общий принцип: сбой уведомления НЕ откатывает уже успешную мутацию в БД —
 * ошибки логируются, но наружу не пробрасываются.
 *
 * Исключение автора (excludeSocketId):
 *   Автор действия получает свежие данные вместе с ответом Server Action
 *   (revalidatePath подкладывает обновлённый RSC-payload), поэтому слать ему
 *   Pusher-эхо бессмысленно — это вызывало второй полный router.refresh().
 *   Клиент передаёт socket_id своего соединения, и Pusher исключает именно
 *   эту вкладку из рассылки (другие вкладки автора событие получат).
 */

import prisma from "@/lib/db";
import { pusherServer } from "@/lib/pusher-server";
import { logger } from "@/lib/logger";

/**
 * Валидирует socket_id, пришедший от клиента.
 * Формат Pusher: "числа.числа" (например "123456.789012").
 * Значение клиент-контролируемое, поэтому проверяем формат, а не доверяем слепо —
 * на невалидный socket_id Pusher бросает ошибку и рассылка не уходит вовсе.
 */
function toSocketId(value: unknown): string | undefined {
  return typeof value === "string" && /^\d+\.\d+$/.test(value)
    ? value
    : undefined;
}

/**
 * Находит всех пользователей с доступом к списку (владелец + ListShare)
 * и отправляет им событие refresh.
 *
 * @param listId - ID списка, участников которого уведомляем.
 * @param excludeSocketId - socket_id вкладки-автора действия (исключается из рассылки).
 */
export async function notifyListMembers(listId: string, excludeSocketId?: unknown) {
  try {
    const list = await prisma.list.findUnique({
      where: { id: listId },
      select: {
        ownerId: true,
        shares: { select: { userId: true } },
      },
    });

    if (!list) return;

    const userIds = [
      ...new Set([
        list.ownerId,
        ...list.shares.map((share) => share.userId),
      ]),
    ];

    await notifyUsers(userIds, excludeSocketId);
  } catch (err) {
    logger.error({ error: err }, "notifyListMembers failed:");
  }
}

/**
 * Уведомляет участников СРАЗУ НЕСКОЛЬКИХ списков одной рассылкой.
 *
 * Нужно операциям, которые затрагивают два списка одновременно — например,
 * переносу записи между списками. Наборы участников у списков разные, и
 * отдельный `notifyListMembers` на каждый из них не годится: пользователь,
 * имеющий доступ к обоим, получил бы два одинаковых `refresh` подряд.
 * Здесь получатели объединяются в один Set до отправки.
 *
 * @param listIds - ID затронутых списков (дубликаты допустимы).
 * @param excludeSocketId - socket_id вкладки-автора действия (исключается из рассылки).
 */
export async function notifyListsMembers(listIds: string[], excludeSocketId?: unknown) {
  try {
    const lists = await prisma.list.findMany({
      where: { id: { in: [...new Set(listIds)] } },
      select: {
        ownerId: true,
        shares: { select: { userId: true } },
      },
    });

    const userIds = [
      ...new Set(
        lists.flatMap((list) => [
          list.ownerId,
          ...list.shares.map((share) => share.userId),
        ]),
      ),
    ];

    if (userIds.length === 0) return;

    await notifyUsers(userIds, excludeSocketId);
  } catch (err) {
    logger.error({ error: err }, "notifyListsMembers failed:");
  }
}

/**
 * Отправляет refresh в личные private-каналы пользователей.
 * Ошибка Pusher логируется, но не ломает уже завершённую мутацию.
 *
 * @param userIds - ID пользователей-получателей.
 * @param excludeSocketId - socket_id вкладки-автора действия (исключается из рассылки).
 */
export async function notifyUsers(userIds: string[], excludeSocketId?: unknown) {
  const socketId = toSocketId(excludeSocketId);

  // Каждому пользователю — свой private-канал.
  // private-* каналы требуют прохождения auth endpoint (/api/pusher/auth),
  // который проверяет, что клиент подписывается только на свой канал.
  // .catch не пробрасывает ошибку наружу — сбой Pusher не откатывает мутацию в БД.
  await Promise.all(
    userIds.map((userId) =>
      pusherServer.trigger(
        `private-user-${userId}`,
        "refresh",
        {},
        socketId ? { socket_id: socketId } : undefined,
      ),
    ),
  ).catch((err) => logger.error("Pusher notify failed:", err));
}
