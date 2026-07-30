/**
 * @file pusher-auth.test.ts
 * @description Проверка построения канала и безопасного контекста логирования.
 *
 * Имя отклонённого канала приходит от клиента и может содержать идентификатор
 * другого пользователя. В лог разрешено попадать только его короткому хешу.
 */

import { describe, expect, it } from "vitest";

import { hashId } from "@/lib/logger";
import {
  buildDeniedPusherChannelLogContext,
  pusherChannelName,
} from "@/lib/pusher-auth";

describe("pusherChannelName", () => {
  it("строит персональный private-канал пользователя", () => {
    expect(pusherChannelName("user_123")).toBe("private-user-user_123");
  });
});

describe("buildDeniedPusherChannelLogContext", () => {
  const userId = "user_current";
  const deniedChannel = "private-user-user_other";

  it("сохраняет только псевдонимы пользователя и канала", () => {
    expect(buildDeniedPusherChannelLogContext(userId, deniedChannel)).toEqual({
      uid: hashId(userId),
      channelHash: hashId(deniedChannel),
      action: "pusherAuth",
    });
  });

  it("не оставляет исходные значения в сериализованном логе", () => {
    const serialized = JSON.stringify(
      buildDeniedPusherChannelLogContext(userId, deniedChannel),
    );

    expect(serialized).not.toContain(userId);
    expect(serialized).not.toContain(deniedChannel);
  });

  it("не использует поле channelName с недоверенным значением", () => {
    const context = buildDeniedPusherChannelLogContext(userId, deniedChannel);

    expect(context).not.toHaveProperty("channelName");
    expect(context.channelHash).toMatch(/^[0-9a-f]{8}$/);
  });
});
