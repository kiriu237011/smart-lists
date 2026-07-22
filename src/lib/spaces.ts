import "server-only";

import type { Prisma } from "@prisma/client";
import prisma from "@/lib/db";

export const LAST_SPACE_COOKIE = "smart-lists-space";
export const MAX_CUSTOM_SPACES = 5;

/** ID default-пространства детерминирован: миграция и рантайм создают одну запись. */
export function defaultSpaceId(userId: string): string {
  return `space_default_${userId}`;
}

/** Нормализация для регистронезависимой уникальности пользовательских имён. */
export function normalizeSpaceName(name: string): string {
  return name.trim().normalize("NFKC").toLowerCase();
}

/** Идемпотентно создаёт default-пространство пользователя. */
export async function ensureSpaceState(userId: string) {
  const spaceId = defaultSpaceId(userId);

  await prisma.space.upsert({
    where: { id: spaceId },
    create: { id: spaceId, userId, isDefault: true },
    update: {},
  });

  return spaceId;
}

/** Возвращает пространство только если оно принадлежит пользователю. */
export async function getUserSpace(userId: string, spaceId: string) {
  return prisma.space.findFirst({
    where: { id: spaceId, userId },
  });
}

/** Prisma-фильтр видимости списка в конкретном пространстве пользователя. */
export function listInSpaceWhere(
  userId: string,
  spaceId: string,
): Prisma.ListWhereInput {
  return {
    OR: [
      { ownerId: userId, spaceId },
      { shares: { some: { userId, spaceId } } },
    ],
  };
}

/** Проверяет доступ к конкретному списку именно из переданного пространства. */
export async function canAccessListInSpace(
  userId: string,
  spaceId: string,
  listId: string,
): Promise<boolean> {
  await ensureSpaceState(userId);
  const list = await prisma.list.findFirst({
    where: { id: listId, ...listInSpaceWhere(userId, spaceId) },
    select: { id: true },
  });
  return Boolean(list);
}
