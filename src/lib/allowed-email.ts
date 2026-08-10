/**
 * @file allowed-email.ts
 * @description Whitelist доступа к приложению и его применение к живой сессии.
 *
 * Список `AllowedEmail` правится прямо в БД, без деплоя. До 2026-08-10 он
 * проверялся только в колбэке `signIn` — то есть ровно в момент входа. У
 * пользователя, которого убрали из списка, сессия продолжала работать до
 * истечения срока: доступ формально отозван, фактически нет. `README` при этом
 * описывал whitelist как управление доступом ко всему приложению, и обещание
 * расходилось с поведением.
 *
 * Цена проверки на каждом чтении сессии — один запрос по уникальному индексу
 * дополнительно к тому, который адаптер и так делает за `Session` и `User`.
 * Кешировать его нельзя: смысл правки именно в том, чтобы отзыв срабатывал
 * сразу, а не когда истечёт кеш.
 */

import prisma from "@/lib/db";

/** Разрешён ли доступ этому email. Пустое значение — не разрешён. */
export async function isEmailAllowed(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;

  const allowed = await prisma.allowedEmail.findUnique({
    where: { email },
    select: { id: true },
  });

  return allowed !== null;
}

/**
 * Удаляет все серверные сессии пользователя.
 *
 * Одного отказа в колбэке было бы мало: cookie осталась бы валидной, и запрос
 * упирался бы в проверку снова и снова. Удаление строки `Session` делает
 * отзыв окончательным — следующий запрос приходит уже как анонимный, и лишний
 * запрос к whitelist больше не выполняется.
 */
export async function revokeUserSessions(userId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId } });
  return count;
}
