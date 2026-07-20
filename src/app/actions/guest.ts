/**
 * @file guest.ts
 * @description Server Actions гостевого режима: вход и выход без аккаунта.
 *
 * Гостевой режим не создаёт пользователя в БД и не использует NextAuth —
 * это просто httpOnly-cookie-флаг. Все данные гостя живут в localStorage
 * браузера (см. `src/lib/guest-storage.ts`), на сервер они не попадают.
 *
 * Разрешение на гостевой вход управляется настройкой "guestModeEnabled"
 * в таблице `AppSetting` (см. `src/lib/app-settings.ts`): выключение флага
 * в БД мгновенно убирает кнопку входа и «разлогинивает» уже вошедших гостей
 * при следующей загрузке страницы (их localStorage-данные при этом остаются).
 */

"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { GUEST_COOKIE, isGuestModeEnabled } from "@/lib/app-settings";
import { logger } from "@/lib/logger";

/**
 * Включает гостевой режим: ставит cookie-флаг и перерисовывает страницу.
 * Флаг в БД проверяется на сервере — клиент не может войти гостем,
 * если гостевой режим выключен (защита от подделки запроса).
 */
export async function enterGuestMode() {
  if (!(await isGuestModeEnabled())) {
    logger.warn({ action: "enterGuestMode.denied" }, "Гостевой вход запрещён настройкой");
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(GUEST_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // Год: гость «залогинен», пока не выйдет сам
    path: "/",
  });

  revalidatePath("/", "layout");
  logger.info({ action: "enterGuestMode" }, "Вход в гостевой режим");
}

/**
 * Выключает гостевой режим: удаляет cookie-флаг.
 * Данные в localStorage браузера НЕ трогаются — при повторном гостевом
 * входе с этого устройства списки вернутся.
 */
export async function exitGuestMode() {
  const cookieStore = await cookies();
  cookieStore.delete(GUEST_COOKIE);

  revalidatePath("/", "layout");
  logger.info({ action: "exitGuestMode" }, "Выход из гостевого режима");
}
