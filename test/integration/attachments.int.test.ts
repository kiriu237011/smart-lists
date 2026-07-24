/**
 * @file attachments.int.test.ts
 * @description Вложения: two-phase-загрузка, квоты, ленивая уборка и доступ.
 *
 * S3 замокан (сеть и секреты не нужны), но вся логика вокруг него настоящая:
 * PENDING-строка занимает квоту до подтверждения, `confirmUpload` доверяет
 * не клиенту, а HeadObject, а зависшие PENDING убираются лениво при следующем
 * запросе загрузки. Проверяется именно это поведение на реальной БД.
 */

import { describe, expect, it, vi } from "vitest";

import {
  confirmUpload,
  deleteAttachment,
  getAttachmentUrl,
  requestUpload,
} from "@/app/actions/attachments";
import {
  MAX_FILES_PER_LIST,
  MAX_FILES_PER_USER,
  STALE_MINUTES,
} from "@/lib/attachments";
import { flushAfter, prisma, setSessionUser } from "./setup";
import { makeList, makeUser, shareList } from "./factories";

/** Готовая строка вложения (по умолчанию UPLOADED) для наполнения квоты. */
async function makeAttachment(
  listId: string,
  uploadedById: string,
  overrides?: { status?: "PENDING" | "UPLOADED"; createdAt?: Date; key?: string },
) {
  return prisma.attachment.create({
    data: {
      key: overrides?.key ?? `lists/${listId}/${crypto.randomUUID()}.png`,
      name: "file.png",
      type: "IMAGE",
      contentType: "image/png",
      size: 100,
      status: overrides?.status ?? "UPLOADED",
      listId,
      uploadedById,
      ...(overrides?.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
}

const PNG = { fileName: "photo.png", contentType: "image/png", size: 1000 };

describe("requestUpload", () => {
  it("создаёт PENDING-строку и возвращает данные для загрузки", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    const result = await requestUpload({
      listId: list.id,
      spaceId: user.defaultSpaceId,
      ...PNG,
    });

    expect(result.success).toBe(true);
    expect(result.upload?.attachmentId).toBeDefined();
    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: result.upload!.attachmentId },
    });
    expect(row.status).toBe("PENDING");
    expect(row.type).toBe("IMAGE");
    expect(row.key).toMatch(new RegExp(`^lists/${list.id}/.+\\.png$`));
  });

  it("отклоняет неразрешённый тип файла", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    const result = await requestUpload({
      listId: list.id,
      spaceId: user.defaultSpaceId,
      fileName: "a.zip",
      contentType: "application/zip",
      size: 1000,
    });

    expect(result).toEqual({ success: false, error: "invalidFileType" });
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("отклоняет файл больше лимита размера", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    const result = await requestUpload({
      listId: list.id,
      spaceId: user.defaultSpaceId,
      fileName: "big.png",
      contentType: "image/png",
      size: 10 * 1024 * 1024 + 1,
    });

    expect(result).toEqual({ success: false, error: "validationError" });
  });

  it("не даёт загрузить в чужой список", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(stranger.id);

    const result = await requestUpload({
      listId: list.id,
      spaceId: stranger.defaultSpaceId,
      ...PNG,
    });

    expect(result).toEqual({ success: false, error: "listNotFound" });
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("редактору загрузка в расшаренный список разрешена", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    setSessionUser(editor.id);

    const result = await requestUpload({
      listId: list.id,
      spaceId: editor.defaultSpaceId,
      ...PNG,
    });

    expect(result.success).toBe(true);
  });

  it("упирается в квоту списка (PENDING тоже считается)", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    // Заполняем список до предела смесью UPLOADED и PENDING.
    for (let i = 0; i < MAX_FILES_PER_LIST; i++) {
      await makeAttachment(list.id, user.id, {
        status: i % 2 === 0 ? "UPLOADED" : "PENDING",
      });
    }
    setSessionUser(user.id);

    const result = await requestUpload({
      listId: list.id,
      spaceId: user.defaultSpaceId,
      ...PNG,
    });

    expect(result).toEqual({ success: false, error: "listQuotaExceeded" });
  });

  it("упирается в квоту пользователя поверх нескольких списков", async () => {
    const user = await makeUser();
    // 20 файлов пользователя, распределённых по 4 спискам (по 5 = квота списка).
    const lists = [];
    for (let l = 0; l < MAX_FILES_PER_USER / MAX_FILES_PER_LIST; l++) {
      const list = await makeList(user.id, user.defaultSpaceId);
      lists.push(list);
      for (let i = 0; i < MAX_FILES_PER_LIST; i++) {
        await makeAttachment(list.id, user.id);
      }
    }
    // Свежий пустой список: квота списка свободна, но пользовательская исчерпана.
    const freshList = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    const result = await requestUpload({
      listId: freshList.id,
      spaceId: user.defaultSpaceId,
      ...PNG,
    });

    expect(result).toEqual({ success: false, error: "userQuotaExceeded" });
  });

  it("лениво убирает зависшие PENDING и освобождает квоту", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const stale = new Date(Date.now() - (STALE_MINUTES + 5) * 60 * 1000);
    // Список забит, но все строки — просроченные PENDING.
    const staleIds: string[] = [];
    for (let i = 0; i < MAX_FILES_PER_LIST; i++) {
      const row = await makeAttachment(list.id, user.id, {
        status: "PENDING",
        createdAt: stale,
      });
      staleIds.push(row.id);
    }
    setSessionUser(user.id);

    const result = await requestUpload({
      listId: list.id,
      spaceId: user.defaultSpaceId,
      ...PNG,
    });

    // Уборка освободила место, новая загрузка прошла.
    expect(result.success).toBe(true);
    // Просроченные PENDING удалены.
    expect(
      await prisma.attachment.count({ where: { id: { in: staleIds } } }),
    ).toBe(0);
  });

  it("не трогает свежие PENDING при уборке", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    // Свежие PENDING (только что созданы) заполняют квоту и убираться не должны.
    for (let i = 0; i < MAX_FILES_PER_LIST; i++) {
      await makeAttachment(list.id, user.id, { status: "PENDING" });
    }
    setSessionUser(user.id);

    const result = await requestUpload({
      listId: list.id,
      spaceId: user.defaultSpaceId,
      ...PNG,
    });

    // Свежие PENDING на месте, квота списка по-прежнему исчерпана.
    expect(result).toEqual({ success: false, error: "listQuotaExceeded" });
    expect(await prisma.attachment.count({ where: { listId: list.id } })).toBe(
      MAX_FILES_PER_LIST,
    );
  });
});

describe("confirmUpload", () => {
  async function pending(userId: string, listId: string) {
    return makeAttachment(listId, userId, { status: "PENDING" });
  }

  it("переводит PENDING в UPLOADED и пишет реальный размер из HeadObject", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const row = await pending(user.id, list.id);
    setSessionUser(user.id);
    const { headObject } = await import("@/lib/s3");
    // HeadObject даёт честный размер, отличный от заявленного при создании.
    vi.mocked(headObject).mockResolvedValueOnce({
      contentLength: 4096,
      contentType: "image/png",
    });

    const result = await confirmUpload({
      attachmentId: row.id,
      spaceId: user.defaultSpaceId,
    });

    expect(result).toEqual({ success: true });
    const updated = await prisma.attachment.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe("UPLOADED");
    expect(updated.size).toBe(4096);
  });

  it("оставляет PENDING, когда файла нет в S3", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const row = await pending(user.id, list.id);
    setSessionUser(user.id);
    // headObject по умолчанию возвращает null (файла нет).

    const result = await confirmUpload({
      attachmentId: row.id,
      spaceId: user.defaultSpaceId,
    });

    expect(result).toEqual({ success: false, error: "uploadNotFound" });
    expect(
      (await prisma.attachment.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe("PENDING");
  });

  it("отбраковывает файл, не прошедший фактическую валидацию", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const row = await pending(user.id, list.id);
    setSessionUser(user.id);
    const { headObject } = await import("@/lib/s3");
    // Реальный файл оказался неразрешённого типа, что бы клиент ни заявлял.
    vi.mocked(headObject).mockResolvedValueOnce({
      contentLength: 100,
      contentType: "application/zip",
    });

    const result = await confirmUpload({
      attachmentId: row.id,
      spaceId: user.defaultSpaceId,
    });

    expect(result).toEqual({ success: false, error: "invalidFileType" });
    expect(
      (await prisma.attachment.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe("PENDING");
  });

  it("идемпотентен: повторный confirm на UPLOADED не находит PENDING", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const row = await makeAttachment(list.id, user.id, { status: "UPLOADED" });
    setSessionUser(user.id);

    const result = await confirmUpload({
      attachmentId: row.id,
      spaceId: user.defaultSpaceId,
    });

    expect(result).toEqual({ success: false, error: "attachmentNotFound" });
  });

  it("уведомляет участников после подтверждения", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const row = await pending(user.id, list.id);
    setSessionUser(user.id);
    const { headObject } = await import("@/lib/s3");
    vi.mocked(headObject).mockResolvedValueOnce({
      contentLength: 100,
      contentType: "image/png",
    });
    const { notifyListMembers } = await import("@/lib/notify");

    await confirmUpload({ attachmentId: row.id, spaceId: user.defaultSpaceId });

    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyListMembers)).toHaveBeenCalledWith(list.id, undefined);
  });
});

describe("deleteAttachment", () => {
  it("удаляет строку и объект из S3", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const row = await makeAttachment(list.id, user.id, { key: "lists/x/f.png" });
    setSessionUser(user.id);
    const { deleteObject } = await import("@/lib/s3");

    const result = await deleteAttachment({
      attachmentId: row.id,
      spaceId: user.defaultSpaceId,
    });

    expect(result).toEqual({ success: true });
    expect(await prisma.attachment.findUnique({ where: { id: row.id } })).toBeNull();
    expect(vi.mocked(deleteObject)).toHaveBeenCalledWith("lists/x/f.png");
  });

  it("любой участник может удалить вложение, не только загрузивший", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    // Файл загрузил владелец, удаляет редактор.
    const row = await makeAttachment(list.id, owner.id);
    setSessionUser(editor.id);

    const result = await deleteAttachment({
      attachmentId: row.id,
      spaceId: editor.defaultSpaceId,
    });

    expect(result).toEqual({ success: true });
    expect(await prisma.attachment.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("не даёт удалить вложение из чужого списка", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const row = await makeAttachment(list.id, owner.id);
    setSessionUser(stranger.id);

    const result = await deleteAttachment({
      attachmentId: row.id,
      spaceId: stranger.defaultSpaceId,
    });

    expect(result).toEqual({ success: false, error: "attachmentNotFound" });
    expect(await prisma.attachment.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("сбой S3 не откатывает удаление строки (best-effort)", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const row = await makeAttachment(list.id, user.id);
    setSessionUser(user.id);
    const { deleteObject } = await import("@/lib/s3");
    vi.mocked(deleteObject).mockRejectedValueOnce(new Error("S3 down"));

    const result = await deleteAttachment({
      attachmentId: row.id,
      spaceId: user.defaultSpaceId,
    });

    // Строка удалена несмотря на сбой очистки S3 — осиротевший файл дешевле битой ссылки.
    expect(result).toEqual({ success: true });
    expect(await prisma.attachment.findUnique({ where: { id: row.id } })).toBeNull();
  });
});

describe("getAttachmentUrl", () => {
  it("выдаёт ссылку на UPLOADED-вложение", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const row = await makeAttachment(list.id, user.id, { status: "UPLOADED" });
    setSessionUser(user.id);

    const result = await getAttachmentUrl({
      attachmentId: row.id,
      spaceId: user.defaultSpaceId,
    });

    expect(result).toMatchObject({ success: true });
    expect(result.url).toBe("https://s3.test/download");
  });

  it("не выдаёт ссылку на ещё не подтверждённый PENDING", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    const row = await makeAttachment(list.id, user.id, { status: "PENDING" });
    setSessionUser(user.id);

    const result = await getAttachmentUrl({
      attachmentId: row.id,
      spaceId: user.defaultSpaceId,
    });

    expect(result).toEqual({ success: false, error: "attachmentNotFound" });
  });

  it("не выдаёт ссылку постороннему", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const row = await makeAttachment(list.id, owner.id, { status: "UPLOADED" });
    setSessionUser(stranger.id);

    const result = await getAttachmentUrl({
      attachmentId: row.id,
      spaceId: stranger.defaultSpaceId,
    });

    expect(result).toEqual({ success: false, error: "attachmentNotFound" });
  });
});
