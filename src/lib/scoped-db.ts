import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import prisma from "@/lib/db";

const USER_SETTING = "app.user_id";
const SPACE_SETTING = "app.space_id";

export type ScopedTransaction = Prisma.TransactionClient;

export class DatabaseContextError extends Error {
  constructor(
    public readonly code: "INVALID_CONTEXT" | "SPACE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "DatabaseContextError";
  }
}

type ScopedWork<T> = (tx: ScopedTransaction) => Promise<T>;

function assertContextId(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.includes("\0")
  ) {
    throw new DatabaseContextError(
      "INVALID_CONTEXT",
      `Некорректный ${label} для контекста БД.`,
    );
  }
}

async function setLocalSetting(
  tx: ScopedTransaction,
  name: string,
  value: string,
): Promise<void> {
  await tx.$queryRaw<Array<{ value: string }>>`
    SELECT set_config(${name}, ${value}, true) AS value
  `;
}

async function assertSettings(
  tx: ScopedTransaction,
  expected: { userId: string; spaceId: string | null },
): Promise<void> {
  const [actual] = await tx.$queryRaw<
    Array<{ userId: string | null; spaceId: string | null }>
  >`
    SELECT
      NULLIF(current_setting(${USER_SETTING}, true), '') AS "userId",
      NULLIF(current_setting(${SPACE_SETTING}, true), '') AS "spaceId"
  `;

  if (
    !actual ||
    actual.userId !== expected.userId ||
    actual.spaceId !== expected.spaceId
  ) {
    throw new DatabaseContextError(
      "INVALID_CONTEXT",
      "PostgreSQL не подтвердил ожидаемый контекст запроса.",
    );
  }
}

/**
 * Создаёт scoped API поверх конкретного Prisma Client.
 *
 * Фабрика нужна интеграционным проверкам и не создаёт новый пул. Production
 * использует экспортированные ниже функции, привязанные к singleton-клиенту.
 */
export function createScopedDatabase(client: PrismaClient) {
  async function withUserDb<T>(userId: string, work: ScopedWork<T>): Promise<T> {
    assertContextId(userId, "userId");

    return client.$transaction(async (tx) => {
      await setLocalSetting(tx, USER_SETTING, userId);
      // User-only поток обязан быть fail-closed для space-политик. Явная пустая
      // настройка также не позволяет унаследовать session-level значение.
      await setLocalSetting(tx, SPACE_SETTING, "");
      await assertSettings(tx, { userId, spaceId: null });
      return work(tx);
    });
  }

  async function withSpaceDb<T>(
    userId: string,
    spaceId: string,
    work: ScopedWork<T>,
  ): Promise<T> {
    assertContextId(userId, "userId");
    assertContextId(spaceId, "spaceId");

    return client.$transaction(async (tx) => {
      await setLocalSetting(tx, USER_SETTING, userId);
      await setLocalSetting(tx, SPACE_SETTING, "");

      // spaceId приходит из URL/FormData, поэтому до публикации в контексте
      // подтверждаем его через серверный userId из auth().
      const space = await tx.space.findFirst({
        where: { id: spaceId, userId },
        select: { id: true },
      });
      if (!space) {
        throw new DatabaseContextError(
          "SPACE_NOT_FOUND",
          "Пространство не найдено.",
        );
      }

      await setLocalSetting(tx, SPACE_SETTING, space.id);
      await assertSettings(tx, { userId, spaceId: space.id });
      return work(tx);
    });
  }

  return { withUserDb, withSpaceDb };
}

export const { withUserDb, withSpaceDb } = createScopedDatabase(prisma);
