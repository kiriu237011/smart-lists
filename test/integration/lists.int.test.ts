/**
 * @file lists.int.test.ts
 * @description Удаление и переименование списка владельцем — успешный путь.
 *
 * Почему отдельным файлом. `access-control.int.test.ts` проверяет у этих двух
 * действий только отказ: «редактор НЕ может переименовать» и «НЕ может
 * удалить». Права закрыты, а того, что происходит при разрешённом вызове, не
 * проверял никто — при том что у `deleteList` там лежит вся нетривиальная
 * часть. Тест, который выглядел покрытием каскада
 * (`sub-items.int.test.ts`, «удаление списка уносит и пункты, и подпункты»),
 * вызывает `prisma.list.delete` напрямую и проверяет схему, а не действие.
 *
 * Соседние действия с такой же S3-уборкой — `deleteSpace` и `deleteAttachment`
 * — свои тесты имеют; здесь закрывается расхождение.
 */

import { describe, expect, it, vi } from "vitest";

import { deleteList, renameList } from "@/app/actions";
import { flushAfter, prisma, setSessionUser } from "./setup";
import { formData, makeItem, makeList, makeUser, shareList } from "./factories";

/** Загруженное вложение списка — источник ключей для фоновой уборки S3. */
async function makeAttachment(listId: string, uploadedById: string, key: string) {
  return prisma.attachment.create({
    data: {
      key,
      name: "file.png",
      type: "IMAGE",
      contentType: "image/png",
      size: 100,
      status: "UPLOADED",
      listId,
      uploadedById,
    },
  });
}

describe("deleteList — владелец", () => {
  it("удаляет список вместе с его записями", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const parent = await makeItem(list.id, { name: "Пункт" });
    await makeItem(list.id, { name: "Подпункт", parentId: parent.id });
    setSessionUser(owner.id);

    const result = await deleteList(
      formData({ listId: list.id, spaceId: owner.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(await prisma.list.findUnique({ where: { id: list.id } })).toBeNull();
    // Счёт по своему списку: файлы гоняются последовательно, но общий счёт по
    // таблице всё равно плохая привычка.
    expect(await prisma.item.count({ where: { listId: list.id } })).toBe(0);
  });

  it("отдаёт ключи вложений в уборку S3", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await makeAttachment(list.id, owner.id, "lists/one/a.png");
    await makeAttachment(list.id, owner.id, "lists/one/b.png");
    setSessionUser(owner.id);
    const { deleteObjects } = await import("@/lib/s3");

    await deleteList(formData({ listId: list.id, spaceId: owner.defaultSpaceId }));

    // Ключи собираются ДО удаления: каскад уносит строки Attachment вместе со
    // списком, и после `deleteMany` взять их уже неоткуда. Перестановка двух
    // запросов местами оставила бы файлы в бакете навсегда — молча.
    expect(vi.mocked(deleteObjects)).toHaveBeenCalledWith([
      "lists/one/a.png",
      "lists/one/b.png",
    ]);
  });

  it("не зовёт S3, когда вложений у списка нет", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);
    const { deleteObjects } = await import("@/lib/s3");

    await deleteList(formData({ listId: list.id, spaceId: owner.defaultSpaceId }));

    expect(vi.mocked(deleteObjects)).not.toHaveBeenCalled();
  });

  it("сбой S3 не откатывает удаление списка (best-effort)", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await makeAttachment(list.id, owner.id, "lists/one/a.png");
    setSessionUser(owner.id);
    const { deleteObjects } = await import("@/lib/s3");
    vi.mocked(deleteObjects).mockRejectedValueOnce(new Error("s3 down"));

    const result = await deleteList(
      formData({ listId: list.id, spaceId: owner.defaultSpaceId }),
    );

    // Осиротевший файл в бакете дешевле битой ссылки в интерфейсе, поэтому
    // строка уходит независимо от S3.
    expect(result).toEqual({ success: true });
    expect(await prisma.list.findUnique({ where: { id: list.id } })).toBeNull();
  });

  it("уведомляет владельца и получателей share, собранных до удаления", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    setSessionUser(owner.id);
    const { notifyUsers } = await import("@/lib/notify");

    await deleteList(formData({ listId: list.id, spaceId: owner.defaultSpaceId }));
    await flushAfter();

    // Именно `notifyUsers`, а не `notifyListMembers`: списка к этому моменту в
    // БД уже нет, и получателей по нему было бы не найти.
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledTimes(1);
    const [userIds] = vi.mocked(notifyUsers).mock.calls[0];
    expect([...userIds].sort()).toEqual([owner.id, editor.id].sort());
  });
});

describe("renameList — владелец", () => {
  it("меняет название своего списка", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId, {
      title: "Старое",
    });
    setSessionUser(owner.id);

    const result = await renameList(
      formData({
        listId: list.id,
        title: "Новое",
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    const stored = await prisma.list.findUniqueOrThrow({
      where: { id: list.id },
      select: { title: true },
    });
    expect(stored.title).toBe("Новое");
  });

  it("уведомляет участников переименованного списка", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await shareList(list.id, editor.id);
    setSessionUser(owner.id);
    const { notifyListMembers } = await import("@/lib/notify");

    await renameList(
      formData({
        listId: list.id,
        title: "Новое",
        spaceId: owner.defaultSpaceId,
      }),
    );
    await flushAfter();

    // Здесь список остаётся в БД, поэтому получателей находит сам notify.
    expect(vi.mocked(notifyListMembers)).toHaveBeenCalledWith(list.id, null);
  });

  it("отвергает слишком длинное название и не трогает строку", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId, {
      title: "Старое",
    });
    setSessionUser(owner.id);

    const result = await renameList(
      formData({
        listId: list.id,
        title: "x".repeat(51),
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(false);
    const stored = await prisma.list.findUniqueOrThrow({
      where: { id: list.id },
      select: { title: true },
    });
    expect(stored.title).toBe("Старое");
  });

  it("отвергает пустое название", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId, {
      title: "Старое",
    });
    setSessionUser(owner.id);

    const result = await renameList(
      formData({ listId: list.id, title: "", spaceId: owner.defaultSpaceId }),
    );

    expect(result.success).toBe(false);
    const stored = await prisma.list.findUniqueOrThrow({
      where: { id: list.id },
      select: { title: true },
    });
    expect(stored.title).toBe("Старое");
  });
});
