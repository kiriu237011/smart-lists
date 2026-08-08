/**
 * @file factories.ts
 * @description Фабрики данных для E2E: готовят состояние прямо через Prisma,
 *              минуя интерфейс.
 *
 * Тест проверяет один поток, а не все шаги, которые к нему ведут: список из
 * тридцати записей быстрее создать в базе, чем накликать. Через интерфейс
 * выполняется только проверяемое действие.
 *
 * Изоляция тестов держится на уникальном пользователе: воркеры идут
 * параллельно против одной базы, и общий TRUNCATE между тестами вытирал бы
 * данные соседа. Пересечься тесты могут только через глобальные строки —
 * `AppSetting` (гостевой режим), поэтому такие тесты помечены serial.
 */

import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

export type E2EUser = {
  id: string;
  email: string;
  name: string;
  /** ID default-пространства: с него начинается любой авторизованный маршрут. */
  defaultSpaceId: string;
};

/**
 * ID default-пространства повторяет `defaultSpaceId()` из `src/lib/spaces.ts`.
 * Импортировать оттуда нельзя: модуль помечен `server-only` и вне RSC-контекста
 * падает на импорте. Формат — часть контракта схемы (миграция создаёт строки с
 * такими же ID), поэтому дублирование безопасно, но менять его нужно в двух
 * местах.
 */
function defaultSpaceId(userId: string): string {
  return `space_default_${userId}`;
}

/**
 * Пользователь с default-пространством и записью в whitelist.
 *
 * `AllowedEmail` для самого прогона не обязателен — whitelist проверяется в
 * колбэке `signIn`, а E2E подставляет сессию напрямую. Строка создаётся, чтобы
 * состояние базы не отличалось от боевого: пользователь, у которого есть
 * сессия, в проде всегда есть и в whitelist.
 */
export async function makeUser(
  db: PrismaClient,
  overrides?: { email?: string; name?: string },
): Promise<E2EUser> {
  const email = overrides?.email ?? `e2e-${randomUUID()}@e2e.local`;
  const name = overrides?.name ?? "E2E User";

  const user = await db.user.create({ data: { email, name } });
  await db.allowedEmail.create({ data: { email } });
  const space = await db.space.create({
    data: { id: defaultSpaceId(user.id), userId: user.id, isDefault: true },
  });

  return { id: user.id, email, name, defaultSpaceId: space.id };
}

/** Дополнительное (не-default) пространство пользователя. */
export async function makeSpace(
  db: PrismaClient,
  userId: string,
  name: string,
) {
  return db.space.create({
    data: {
      userId,
      name,
      normalizedName: name.trim().normalize("NFKC").toLowerCase(),
    },
  });
}

/** Список во владении пользователя, размещённый в его пространстве. */
export async function makeList(
  db: PrismaClient,
  ownerId: string,
  spaceId: string,
  overrides?: { title?: string; note?: string },
) {
  return db.list.create({
    data: {
      title: overrides?.title ?? "Список",
      ownerId,
      spaceId,
      note: overrides?.note,
    },
  });
}

/**
 * Записи списка в заданном порядке: позиции 1..n по порядку имён.
 * Так тест перемещения не зависит от того, как позиции лягут при добавлении.
 */
export async function makeItems(
  db: PrismaClient,
  listId: string,
  names: string[],
  overrides?: { addedById?: string },
) {
  const items = [];
  for (const [index, name] of names.entries()) {
    items.push(
      await db.item.create({
        data: {
          listId,
          name,
          position: index + 1,
          addedById: overrides?.addedById,
        },
      }),
    );
  }
  return items;
}

/**
 * Подпункты одного пункта в заданном порядке.
 *
 * Позиции считаются внутри родителя: у подпунктов и пунктов независимые
 * последовательности, и позиция 1 у подпункта не спорит с позицией 1 у пункта.
 */
export async function makeSubItems(
  db: PrismaClient,
  listId: string,
  parentId: string,
  names: string[],
) {
  const items = [];
  for (const [index, name] of names.entries()) {
    items.push(
      await db.item.create({
        data: { listId, parentId, name, position: index + 1 },
      }),
    );
  }
  return items;
}

/** Расшаривает список получателю с размещением в его пространстве. */
export async function shareListWith(
  db: PrismaClient,
  listId: string,
  recipient: E2EUser,
  spaceId?: string,
) {
  return db.listShare.create({
    data: {
      listId,
      userId: recipient.id,
      spaceId: spaceId ?? recipient.defaultSpaceId,
    },
  });
}

/** Включает или выключает гостевой режим (глобальная настройка приложения). */
export async function setGuestMode(
  db: PrismaClient,
  enabled: boolean,
): Promise<void> {
  const value = enabled ? "true" : "false";
  await db.appSetting.upsert({
    where: { key: "guestModeEnabled" },
    create: { key: "guestModeEnabled", value },
    update: { value },
  });
}
