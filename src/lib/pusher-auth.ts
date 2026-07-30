/**
 * @file pusher-auth.ts
 * @description Чистые хелперы авторизации персонального Pusher-канала.
 */

import "server-only";

import { hashId } from "@/lib/logger";

export function pusherChannelName(userId: string): string {
  return `private-user-${userId}`;
}

/**
 * Не сохраняет присланное клиентом имя канала: оно может содержать приватный
 * идентификатор другого пользователя или произвольный недоверенный текст.
 */
export function buildDeniedPusherChannelLogContext(
  userId: string,
  channelName: string,
) {
  return {
    uid: hashId(userId),
    channelHash: hashId(channelName),
    action: "pusherAuth",
  } as const;
}
