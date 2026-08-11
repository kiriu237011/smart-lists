/**
 * @file factories.ts
 * @description Фабрики тестовых данных для интеграционных тестов.
 *
 * Создают сущности прямо через Prisma, минуя Server Actions: тест готовит
 * исходное состояние быстро и без проверок доступа, а проверяемое действие
 * вызывает уже отдельно. Пользователь всегда получает default-пространство —
 * ровно как в приложении при первом входе (`ensureSpaceState`).
 */

import { randomUUID } from "node:crypto";

import { ensureSpaceState } from "@/lib/spaces";
import { prisma } from "./setup";

/** Пользователь с гарантированным default-пространством. */
export async function makeUser(overrides?: { email?: string; name?: string }) {
  const email = overrides?.email ?? `user-${randomUUID()}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: overrides?.name ?? "Тестовый пользователь" },
  });
  const defaultSpaceId = await ensureSpaceState(user.id);
  return { ...user, defaultSpaceId };
}

/** Дополнительное (не-default) пространство пользователя. */
export async function makeSpace(userId: string, name: string) {
  return prisma.space.create({
    data: {
      userId,
      name,
      normalizedName: name.trim().normalize("NFKC").toLowerCase(),
    },
  });
}

/** Список во владении пользователя, размещённый в его пространстве. */
export async function makeList(
  ownerId: string,
  spaceId: string,
  overrides?: { title?: string },
) {
  return prisma.list.create({
    data: {
      title: overrides?.title ?? "Список",
      ownerId,
      spaceId,
    },
  });
}

/**
 * Запись в списке. Позиция по умолчанию наследует «максимум + 1», чтобы
 * фабрика повторяла порядок добавления через Action, но её можно задать явно
 * для тестов перемещения.
 *
 * `parentId` создаёт подпункт: позиция тогда считается среди подпунктов того
 * же родителя, а не среди пунктов списка — позиции сравнимы только внутри
 * своей группы.
 */
export async function makeItem(
  listId: string,
  overrides?: {
    name?: string;
    position?: number;
    isCompleted?: boolean;
    addedById?: string;
    parentId?: string;
  },
) {
  const parentId = overrides?.parentId ?? null;
  let position = overrides?.position;
  if (position === undefined) {
    const last = await prisma.item.findFirst({
      where: { listId, parentId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    position = (last?.position ?? 0) + 1;
  }

  return prisma.item.create({
    data: {
      listId,
      parentId,
      name: overrides?.name ?? "Запись",
      position,
      isCompleted: overrides?.isCompleted ?? false,
      addedById: overrides?.addedById,
    },
  });
}

/**
 * Расшаривает список получателю с размещением в его пространстве.
 * По умолчанию — в default-пространстве получателя, как это делает `shareList`.
 */
export async function shareList(
  listId: string,
  recipientId: string,
  spaceId?: string,
) {
  const recipientSpaceId = spaceId ?? (await ensureSpaceState(recipientId));
  return prisma.listShare.create({
    data: { listId, userId: recipientId, spaceId: recipientSpaceId },
  });
}

/** FormData из плоского объекта — Server Actions принимают именно её. */
export function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
}
