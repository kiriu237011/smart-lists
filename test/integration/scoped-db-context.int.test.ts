import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { PrismaClient } from "@/generated/prisma/client";
import type { ScopedTransaction } from "@/lib/scoped-db";
import { createScopedDatabase } from "@/lib/scoped-db";
import {
  canAccessListInSpace,
  getUserSpace,
  listInSpaceWhere,
} from "@/lib/spaces";
import { makeList, makeSpace, makeUser, shareList } from "./factories";

const singleConnectionPrisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
    max: 1,
  }),
});
const { withUserDb, withSpaceDb } = createScopedDatabase(
  singleConnectionPrisma,
);

afterAll(async () => {
  await singleConnectionPrisma.$disconnect();
});

async function readContext(tx: ScopedTransaction) {
  const [context] = await tx.$queryRaw<
    Array<{ userId: string | null; spaceId: string | null }>
  >`
    SELECT
      NULLIF(current_setting('app.user_id', true), '') AS "userId",
      NULLIF(current_setting('app.space_id', true), '') AS "spaceId"
  `;
  return context;
}

describe("scoped transaction context", () => {
  it("устанавливает только userId для пользовательского потока", async () => {
    const user = await makeUser();

    const context = await withUserDb(user.id, readContext);

    expect(context).toEqual({ userId: user.id, spaceId: null });
  });

  it("устанавливает userId и подтверждённый spaceId", async () => {
    const user = await makeUser();

    const context = await withSpaceDb(
      user.id,
      user.defaultSpaceId,
      readContext,
    );

    expect(context).toEqual({
      userId: user.id,
      spaceId: user.defaultSpaceId,
    });
  });

  it("не запускает tenant-код для чужого пространства", async () => {
    const user = await makeUser();
    const stranger = await makeUser();
    const work = vi.fn(async () => "unreachable");

    await expect(
      withSpaceDb(user.id, stranger.defaultSpaceId, work),
    ).rejects.toMatchObject({
      code: "SPACE_NOT_FOUND",
    });
    expect(work).not.toHaveBeenCalled();
  });

  it("отклоняет пустые идентификаторы до открытия tenant-контекста", async () => {
    const work = vi.fn(async () => "unreachable");

    await expect(withUserDb("  ", work)).rejects.toMatchObject({
      code: "INVALID_CONTEXT",
    });
    await expect(withSpaceDb("user", "\0", work)).rejects.toMatchObject({
      code: "INVALID_CONTEXT",
    });
    await expect(
      withUserDb(null as unknown as string, work),
    ).rejects.toMatchObject({ code: "INVALID_CONTEXT" });
    expect(work).not.toHaveBeenCalled();
  });

  it("не переносит spaceId из space-контекста в следующий user-контекст", async () => {
    const user = await makeUser();

    await withSpaceDb(user.id, user.defaultSpaceId, readContext);
    const nextContext = await withUserDb(user.id, readContext);

    expect(nextContext).toEqual({ userId: user.id, spaceId: null });
  });

  it("откатывает контекст вместе с транзакцией при ошибке callback", async () => {
    const user = await makeUser();
    const marker = new Error("rollback marker");

    await expect(
      withSpaceDb(user.id, user.defaultSpaceId, async (tx) => {
        expect(await readContext(tx)).toEqual({
          userId: user.id,
          spaceId: user.defaultSpaceId,
        });
        throw marker;
      }),
    ).rejects.toBe(marker);

    const [outside] = await singleConnectionPrisma.$queryRaw<
      Array<{ userId: string | null; spaceId: string | null }>
    >`
      SELECT
        NULLIF(current_setting('app.user_id', true), '') AS "userId",
        NULLIF(current_setting('app.space_id', true), '') AS "spaceId"
    `;
    expect(outside).toEqual({ userId: null, spaceId: null });
  });

  it("space helpers сохраняют ownership и привязку share к пространству", async () => {
    const owner = await makeUser();
    const recipient = await makeUser();
    const ownerSpace = await makeSpace(owner.id, "Проект");
    const list = await makeList(owner.id, ownerSpace.id);

    expect(await getUserSpace(owner.id, ownerSpace.id)).toMatchObject({
      id: ownerSpace.id,
      userId: owner.id,
    });
    expect(await getUserSpace(recipient.id, ownerSpace.id)).toBeNull();
    expect(
      await canAccessListInSpace(owner.id, ownerSpace.id, list.id),
    ).toBe(true);
    expect(
      await canAccessListInSpace(recipient.id, ownerSpace.id, list.id),
    ).toBe(false);

    await shareList(list.id, recipient.id);
    expect(
      await canAccessListInSpace(
        recipient.id,
        recipient.defaultSpaceId,
        list.id,
      ),
    ).toBe(true);
    expect(
      await canAccessListInSpace(recipient.id, "\0", list.id),
    ).toBe(false);
  });

  it("server reads не смешивают списки и группы разных пространств", async () => {
    const user = await makeUser();
    const owner = await makeUser();
    const firstSpace = await makeSpace(user.id, "Первое");
    const secondSpace = await makeSpace(user.id, "Второе");
    const ownFirst = await makeList(user.id, firstSpace.id);
    const ownSecond = await makeList(user.id, secondSpace.id);
    const shared = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(shared.id, user.id, firstSpace.id);
    const firstGroup = await singleConnectionPrisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: firstSpace.id,
        name: "Первая группа",
        position: 1,
      },
    });
    await singleConnectionPrisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: secondSpace.id,
        name: "Вторая группа",
        position: 1,
      },
    });

    const result = await withSpaceDb(user.id, firstSpace.id, async (tx) => {
      const [spaces, lists, groups] = await Promise.all([
        tx.space.findMany({ where: { userId: user.id } }),
        tx.list.findMany({
          where: listInSpaceWhere(user.id, firstSpace.id),
          select: { id: true },
        }),
        tx.listGroup.findMany({
          where: { userId: user.id, spaceId: firstSpace.id },
          select: { id: true },
        }),
      ]);
      return { spaces, lists, groups };
    });

    expect(result.spaces.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        user.defaultSpaceId,
        firstSpace.id,
        secondSpace.id,
      ]),
    );
    expect(result.lists.map(({ id }) => id).sort()).toEqual(
      [ownFirst.id, shared.id].sort(),
    );
    expect(result.lists).not.toContainEqual({ id: ownSecond.id });
    expect(result.groups).toEqual([{ id: firstGroup.id }]);
  });
});
