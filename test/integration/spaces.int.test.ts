/**
 * @file spaces.int.test.ts
 * @description Пространства: лимит, уникальность имён, каскад удаления и защита
 *              default-пространства.
 *
 * Пространство — верхний контейнер всех данных пользователя, поэтому его
 * удаление обязано снести списки, группы и размещённые чужие shares, а S3-ключи
 * удалённых вложений — уйти в фоновую очистку. Default-пространство существует
 * всегда и не удаляется/не участвует в лимите — обе гарантии проверяются здесь.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createSpace,
  deleteSpace,
  getSpaceDeleteImpact,
  rememberSpace,
  renameSpace,
} from "@/app/actions/spaces";
import { LAST_SPACE_COOKIE, MAX_CUSTOM_SPACES } from "@/lib/spaces";
import {
  clearSession,
  flushAfter,
  getCookie,
  prisma,
  setCookie,
  setSessionUser,
} from "./setup";
import { makeList, makeSpace, makeUser, shareList } from "./factories";

describe("createSpace", () => {
  it("создаёт дополнительное пространство", async () => {
    const user = await makeUser();
    setSessionUser(user.id);

    const result = await createSpace("Работа");

    expect(result.success).toBe(true);
    const spaces = await prisma.space.findMany({
      where: { userId: user.id, isDefault: false },
    });
    expect(spaces.map((s) => s.name)).toEqual(["Работа"]);
  });

  it("без сессии отклоняет", async () => {
    clearSession();
    const result = await createSpace("Работа");
    expect(result).toEqual({ success: false, error: "unauthorized" });
  });

  it("отклоняет пустое и слишком длинное имя", async () => {
    const user = await makeUser();
    setSessionUser(user.id);

    expect((await createSpace("   ")).error).toBe("invalidName");
    expect((await createSpace("я".repeat(51))).error).toBe("invalidName");
    expect(await prisma.space.count({ where: { isDefault: false } })).toBe(0);
  });

  it("не допускает дубликат имени без учёта регистра", async () => {
    const user = await makeUser();
    setSessionUser(user.id);
    await createSpace("Работа");

    const result = await createSpace("  работа  ");

    expect(result).toEqual({ success: false, error: "duplicateName" });
    expect(await prisma.space.count({ where: { userId: user.id, isDefault: false } })).toBe(1);
  });

  it("упирается в лимит дополнительных пространств", async () => {
    const user = await makeUser();
    setSessionUser(user.id);
    for (let i = 0; i < MAX_CUSTOM_SPACES; i++) {
      expect((await createSpace(`Пространство ${i}`)).success).toBe(true);
    }

    const result = await createSpace("Ещё одно");

    expect(result).toEqual({ success: false, error: "limitReached" });
    expect(
      await prisma.space.count({ where: { userId: user.id, isDefault: false } }),
    ).toBe(MAX_CUSTOM_SPACES);
  });

  it("лимит считается по пользователю: у другого свои пять", async () => {
    const first = await makeUser();
    const second = await makeUser();

    setSessionUser(first.id);
    for (let i = 0; i < MAX_CUSTOM_SPACES; i++) await createSpace(`A${i}`);

    setSessionUser(second.id);
    const result = await createSpace("Первое у второго");

    expect(result.success).toBe(true);
  });
});

describe("renameSpace", () => {
  it("переименовывает собственное пространство", async () => {
    const user = await makeUser();
    const space = await makeSpace(user.id, "Старое");
    setSessionUser(user.id);

    const result = await renameSpace(space.id, "Новое");

    expect(result).toEqual({ success: true });
    const updated = await prisma.space.findUniqueOrThrow({ where: { id: space.id } });
    expect(updated.name).toBe("Новое");
    expect(updated.normalizedName).toBe("новое");
  });

  it("не переименовывает чужое пространство", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const space = await makeSpace(owner.id, "Owner space");
    setSessionUser(other.id);

    const result = await renameSpace(space.id, "Взломано");

    expect(result).toEqual({ success: false, error: "notFound" });
    const unchanged = await prisma.space.findUniqueOrThrow({ where: { id: space.id } });
    expect(unchanged.name).toBe("Owner space");
  });

  it("отклоняет переименование в уже занятое имя", async () => {
    const user = await makeUser();
    await makeSpace(user.id, "Работа");
    const target = await makeSpace(user.id, "Дом");
    setSessionUser(user.id);

    const result = await renameSpace(target.id, "работа");

    expect(result).toEqual({ success: false, error: "duplicateName" });
  });
});

describe("deleteSpace", () => {
  it("удаляет пространство и каскадно его содержимое", async () => {
    const user = await makeUser();
    const space = await makeSpace(user.id, "Проект");
    const list = await makeList(user.id, space.id);
    await prisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: space.id,
        name: "Группа",
        position: 1,
      },
    });
    setSessionUser(user.id);

    const result = await deleteSpace(space.id, "Проект");

    expect(result).toEqual({ success: true });
    expect(await prisma.space.findUnique({ where: { id: space.id } })).toBeNull();
    expect(await prisma.list.findUnique({ where: { id: list.id } })).toBeNull();
    expect(await prisma.listGroup.count({ where: { spaceId: space.id } })).toBe(0);
  });

  it("убирает размещённые в пространстве чужие shares", async () => {
    const owner = await makeUser();
    const recipient = await makeUser();
    const recipientSpace = await makeSpace(recipient.id, "Входящие");
    const list = await makeList(owner.id, owner.defaultSpaceId);
    // Чужой список размещён у получателя в удаляемом пространстве.
    await shareList(list.id, recipient.id, recipientSpace.id);
    setSessionUser(recipient.id);

    await deleteSpace(recipientSpace.id, "Входящие");

    // Размещение исчезло, но сам список владельца не тронут.
    expect(
      await prisma.listShare.count({ where: { listId: list.id } }),
    ).toBe(0);
    expect(await prisma.list.findUnique({ where: { id: list.id } })).not.toBeNull();
  });

  it("не удаляет default-пространство", async () => {
    const user = await makeUser();
    setSessionUser(user.id);

    const result = await deleteSpace(user.defaultSpaceId, "что угодно");

    expect(result).toEqual({ success: false, error: "defaultSpace" });
    expect(
      await prisma.space.findUnique({ where: { id: user.defaultSpaceId } }),
    ).not.toBeNull();
  });

  it("требует точного подтверждающего имени", async () => {
    const user = await makeUser();
    const space = await makeSpace(user.id, "Проект");
    setSessionUser(user.id);

    const result = await deleteSpace(space.id, "не то имя");

    expect(result).toEqual({ success: false, error: "confirmationMismatch" });
    expect(await prisma.space.findUnique({ where: { id: space.id } })).not.toBeNull();
  });

  it("не удаляет чужое пространство", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const space = await makeSpace(owner.id, "Owner");
    setSessionUser(other.id);

    const result = await deleteSpace(space.id, "Owner");

    expect(result).toEqual({ success: false, error: "notFound" });
    expect(await prisma.space.findUnique({ where: { id: space.id } })).not.toBeNull();
  });

  it("отдаёт ключи вложений в фоновую очистку S3", async () => {
    const user = await makeUser();
    const space = await makeSpace(user.id, "С файлами");
    const list = await makeList(user.id, space.id);
    await prisma.attachment.create({
      data: {
        key: "lists/x/file.png",
        name: "file.png",
        type: "IMAGE",
        contentType: "image/png",
        size: 100,
        status: "UPLOADED",
        listId: list.id,
        uploadedById: user.id,
      },
    });
    setSessionUser(user.id);
    const { deleteObjects } = await import("@/lib/s3");
    const { notifyUsers } = await import("@/lib/notify");

    await deleteSpace(space.id, "С файлами");

    // До flushAfter внешние эффекты ещё не запущены: DB commit уже завершён,
    // но S3 и realtime идут только после ответа.
    expect(vi.mocked(deleteObjects)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(deleteObjects)).toHaveBeenCalledWith(["lists/x/file.png"]);
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledWith([]);
  });

  it("чистит cookie последнего пространства, если удалили именно его", async () => {
    const user = await makeUser();
    const space = await makeSpace(user.id, "Текущее");
    setSessionUser(user.id);
    setCookie(LAST_SPACE_COOKIE, space.id);

    await deleteSpace(space.id, "Текущее");

    expect(getCookie(LAST_SPACE_COOKIE)).toBeUndefined();
  });
});

describe("getSpaceDeleteImpact", () => {
  it("считает содержимое пространства", async () => {
    const user = await makeUser();
    const recipient = await makeUser();
    const space = await makeSpace(user.id, "Проект");
    const listA = await makeList(user.id, space.id);
    await makeList(user.id, space.id);
    await prisma.listGroup.create({
      data: {
        userId: user.id,
        spaceId: space.id,
        name: "Группа",
        position: 1,
      },
    });
    await shareList(listA.id, recipient.id);
    await prisma.attachment.create({
      data: {
        key: "lists/a/f.png",
        name: "f.png",
        type: "IMAGE",
        contentType: "image/png",
        size: 1,
        status: "UPLOADED",
        listId: listA.id,
      },
    });
    setSessionUser(user.id);

    const result = await getSpaceDeleteImpact(space.id);

    expect(result).toMatchObject({
      success: true,
      impact: { lists: 2, groups: 1, files: 1, collaborators: 1 },
    });
  });

  it("отклоняет default-пространство", async () => {
    const user = await makeUser();
    setSessionUser(user.id);

    expect(await getSpaceDeleteImpact(user.defaultSpaceId)).toEqual({
      success: false,
      error: "defaultSpace",
    });
  });
});

describe("rememberSpace", () => {
  it("сохраняет cookie для своего пространства", async () => {
    const user = await makeUser();
    const space = await makeSpace(user.id, "Проект");
    setSessionUser(user.id);

    const result = await rememberSpace(space.id);

    expect(result).toEqual({ success: true });
    expect(getCookie(LAST_SPACE_COOKIE)).toBe(space.id);
  });

  it("не запоминает чужое пространство", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const space = await makeSpace(owner.id, "Owner");
    setSessionUser(other.id);

    const result = await rememberSpace(space.id);

    expect(result).toEqual({ success: false });
    expect(getCookie(LAST_SPACE_COOKIE)).toBeUndefined();
  });
});
