/**
 * @file app-settings.ts
 * @description Чтение настроек приложения из таблицы `AppSetting` (ключ — значение).
 *
 * Серверный модуль (использует Prisma — не импортировать в клиентские компоненты).
 *
 * Настройки управляются напрямую в БД без деплоя — тот же подход, что и
 * whitelist `AllowedEmail` (см. `auth.ts`).
 *
 * Управление гостевым режимом (SQL в БД):
 *   -- разрешить гостевой вход:
 *   INSERT INTO "AppSetting" ("key", "value", "updatedAt")
 *   VALUES ('guestModeEnabled', 'true', NOW())
 *   ON CONFLICT ("key") DO UPDATE SET "value" = 'true', "updatedAt" = NOW();
 *
 *   -- запретить гостевой вход:
 *   UPDATE "AppSetting" SET "value" = 'false', "updatedAt" = NOW()
 *   WHERE "key" = 'guestModeEnabled';
 */

import prisma from "@/lib/db";
import { logger } from "@/lib/logger";

/** Имя cookie гостевого режима (ставится/удаляется в `actions/guest.ts`). */
export const GUEST_COOKIE = "guest-mode";

/** Ключ настройки, разрешающей гостевой вход. */
const GUEST_MODE_KEY = "guestModeEnabled";

/**
 * Проверяет, разрешён ли гостевой вход.
 *
 * Разрешено только при явном значении "true" — отсутствие строки или любое
 * другое значение означает запрет (безопасное поведение по умолчанию).
 * Ошибка запроса тоже трактуется как запрет: страница входа не должна падать
 * из-за проблем с БД.
 */
export async function isGuestModeEnabled(): Promise<boolean> {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: GUEST_MODE_KEY },
      select: { value: true },
    });
    return setting?.value === "true";
  } catch (error) {
    logger.error({ error }, "Не удалось прочитать настройку гостевого режима");
    return false;
  }
}
