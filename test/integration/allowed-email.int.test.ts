/**
 * @file allowed-email.int.test.ts
 * @description Whitelist доступа и отзыв живых сессий.
 *
 * Колбэк `session` из `@/auth` в интеграционных тестах недоступен: `@/auth`
 * там замокан целиком, иначе каждый тест тащил бы за собой OAuth. Поэтому
 * проверяется вынесенная из колбэка логика — та самая, что он вызывает, — и
 * проверяется против настоящей БД: обе функции состоят из запросов Prisma, и
 * мок здесь проверял бы сам себя.
 *
 * Пользовательский эффект (отозванный пользователь оказывается на экране
 * входа) покрыт отдельно в `test/e2e/auth-routing.e2e.ts`.
 */

import { describe, expect, it } from "vitest";

import { isEmailAllowed, revokeUserSessions } from "@/lib/allowed-email";
import { adminPrisma, prisma } from "./setup";
import { makeUser } from "./factories";

/** Сессия пользователя — такая же строка, какую создаёт Prisma Adapter. */
async function makeSession(userId: string) {
  return prisma.session.create({
    data: {
      userId,
      sessionToken: `token_${userId}_${Math.random().toString(36).slice(2)}`,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
}

describe("whitelist доступа", () => {
  it("пускает email из AllowedEmail", async () => {
    const user = await makeUser();
    await adminPrisma.allowedEmail.create({ data: { email: user.email! } });

    expect(await isEmailAllowed(user.email)).toBe(true);
  });

  it("не пускает email, которого в списке нет", async () => {
    const user = await makeUser();

    expect(await isEmailAllowed(user.email)).toBe(false);
  });

  it("не пускает пустое значение", async () => {
    // Отдельная ветка, а не частный случай запроса: `findUnique` по пустой
    // строке вернул бы null и без явной проверки, но `null`/`undefined` в
    // `where` Prisma воспринял бы как отсутствие фильтра.
    expect(await isEmailAllowed(null)).toBe(false);
    expect(await isEmailAllowed(undefined)).toBe(false);
    expect(await isEmailAllowed("")).toBe(false);
  });
});

describe("отзыв сессий", () => {
  it("удаляет все сессии пользователя и сообщает их число", async () => {
    const user = await makeUser();
    await makeSession(user.id);
    await makeSession(user.id);

    expect(await revokeUserSessions(user.id)).toBe(2);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("не трогает сессии других пользователей", async () => {
    const revoked = await makeUser();
    const untouched = await makeUser();
    await makeSession(revoked.id);
    await makeSession(untouched.id);

    await revokeUserSessions(revoked.id);

    expect(await prisma.session.count({ where: { userId: untouched.id } })).toBe(1);
  });

  it("на пользователе без сессий не падает", async () => {
    const user = await makeUser();

    expect(await revokeUserSessions(user.id)).toBe(0);
  });
});
