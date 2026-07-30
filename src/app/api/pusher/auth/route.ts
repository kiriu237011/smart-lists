/**
 * @file route.ts
 * @description Pusher auth endpoint для private-каналов.
 *
 * Pusher вызывает этот endpoint при подписке на private-* канал,
 * чтобы убедиться, что клиент авторизован подписаться на него.
 *
 * Логика: пользователь может подписаться только на свой канал
 * `private-user-<его_userId>`. Всё остальное — 403.
 */

import { auth } from "@/auth";
import { logger, hashId } from "@/lib/logger";
import {
  buildDeniedPusherChannelLogContext,
  pusherChannelName,
} from "@/lib/pusher-auth";
import { pusherServer } from "@/lib/pusher-server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    logger.warn({ action: "pusherAuth" }, "Неавторизованный запрос к Pusher auth");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.text();
  const params = new URLSearchParams(body);
  const socketId = params.get("socket_id");
  const channelName = params.get("channel_name");

  if (!socketId || !channelName) {
    logger.warn({ uid: hashId(session.user.id), action: "pusherAuth" }, "Pusher auth: отсутствуют socket_id или channel_name");
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // Разрешаем подписку только на собственный канал пользователя
  const expectedChannel = pusherChannelName(session.user.id);
  if (channelName !== expectedChannel) {
    logger.warn(
      buildDeniedPusherChannelLogContext(session.user.id, channelName),
      "Попытка подписки на чужой Pusher-канал",
    );
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const authResponse = pusherServer.authorizeChannel(socketId, channelName);
  return NextResponse.json(authResponse);
}
