"use server";

import { after } from "next/server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import prisma from "@/lib/db";
import { deleteObjects } from "@/lib/s3";
import { logger } from "@/lib/logger";
import { notifyUsers } from "@/lib/notify";
import {
  ensureSpaceState,
  getUserSpace,
  LAST_SPACE_COOKIE,
  MAX_CUSTOM_SPACES,
  normalizeSpaceName,
} from "@/lib/spaces";

const nameSchema = z.string().trim().min(1).max(50);
const idSchema = z.string().min(1).max(100);

function errorCode(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "duplicateName";
  }
  return "unknownError";
}

export async function createSpace(name: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "unauthorized" };

  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { success: false, error: "invalidName" };

  const userId = session.user.id;
  await ensureSpaceState(userId);

  try {
    const space = await prisma.$transaction(
      async (tx) => {
        const count = await tx.space.count({ where: { userId, isDefault: false } });
        if (count >= MAX_CUSTOM_SPACES) return null;
        return tx.space.create({
          data: {
            userId,
            name: parsed.data,
            normalizedName: normalizeSpaceName(parsed.data),
          },
          select: { id: true, name: true, isDefault: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!space) return { success: false, error: "limitReached" };
    revalidatePath("/", "layout");
    return { success: true, space };
  } catch (error) {
    logger.error({ error, action: "createSpace" }, "Не удалось создать пространство");
    return { success: false, error: errorCode(error) };
  }
}

export async function renameSpace(spaceId: string, name: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "unauthorized" };

  const parsedId = idSchema.safeParse(spaceId);
  const parsedName = nameSchema.safeParse(name);
  if (!parsedId.success || !parsedName.success) {
    return { success: false, error: "invalidName" };
  }

  try {
    const updated = await prisma.space.updateMany({
      where: { id: parsedId.data, userId: session.user.id },
      data: {
        name: parsedName.data,
        normalizedName: normalizeSpaceName(parsedName.data),
      },
    });
    if (updated.count === 0) return { success: false, error: "notFound" };
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    return { success: false, error: errorCode(error) };
  }
}

export async function getSpaceDeleteImpact(spaceId: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "unauthorized" };
  if (!idSchema.safeParse(spaceId).success) return { success: false, error: "notFound" };

  const space = await prisma.space.findFirst({
    where: { id: spaceId, userId: session.user.id },
    select: {
      isDefault: true,
      _count: { select: { lists: true, groups: true, receivedShares: true } },
      lists: { select: { _count: { select: { files: true, shares: true } } } },
    },
  });
  if (!space) return { success: false, error: "notFound" };
  if (space.isDefault) return { success: false, error: "defaultSpace" };

  return {
    success: true,
    impact: {
      lists: space._count.lists,
      groups: space._count.groups,
      receivedShares: space._count.receivedShares,
      files: space.lists.reduce((sum, list) => sum + list._count.files, 0),
      collaborators: space.lists.reduce((sum, list) => sum + list._count.shares, 0),
    },
  };
}

export async function deleteSpace(spaceId: string, confirmationName: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "unauthorized" };
  const userId = session.user.id;
  const space = await getUserSpace(userId, spaceId);
  if (!space) return { success: false, error: "notFound" };
  if (space.isDefault) return { success: false, error: "defaultSpace" };
  if (normalizeSpaceName(confirmationName) !== space.normalizedName) {
    return { success: false, error: "confirmationMismatch" };
  }

  const ownedLists = await prisma.list.findMany({
    where: { ownerId: userId, spaceId },
    select: {
      files: { select: { key: true } },
      shares: { select: { userId: true } },
    },
  });
  const keys = ownedLists.flatMap((list) => list.files.map((file) => file.key));
  const affectedUsers = [
    ...new Set(
      ownedLists.flatMap((list) =>
        list.shares.map((share) => share.userId),
      ),
    ),
  ];

  await prisma.space.delete({ where: { id: spaceId } });
  const cookieStore = await cookies();
  if (cookieStore.get(LAST_SPACE_COOKIE)?.value === spaceId) {
    cookieStore.delete(LAST_SPACE_COOKIE);
  }
  revalidatePath("/", "layout");

  after(async () => {
    try {
      // S3 DeleteObjects принимает максимум 1000 ключей за запрос.
      for (let index = 0; index < keys.length; index += 1000) {
        await deleteObjects(keys.slice(index, index + 1000));
      }
    } catch (error) {
      logger.error({ error, spaceId, action: "deleteSpace.s3" }, "Не удалось очистить S3");
    }
    await notifyUsers(affectedUsers);
  });

  return { success: true };
}

export async function rememberSpace(spaceId: string) {
  const session = await auth();
  if (!session?.user?.id) return { success: false };
  const space = await getUserSpace(session.user.id, spaceId);
  if (!space) return { success: false };

  const cookieStore = await cookies();
  cookieStore.set(LAST_SPACE_COOKIE, spaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { success: true };
}
