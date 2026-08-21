/**
 * @file sharing.int.test.ts
 * @description Совместный доступ: выдача, отзыв и самостоятельный выход.
 *
 * Проверяется полный контракт `ListShare`: получатель видит список в своём
 * default-пространстве, повторная выдача идемпотентна, отозвать доступ может
 * только владелец, а выйти — сам участник. Разделение `removeSharedUser`
 * (действует владелец) и `leaveSharedList` (действует участник) — ключевое:
 * перепутанные проверки дали бы владельцу возможность «выйти» за другого или
 * участнику — отписать владельца.
 */

import { describe, expect, it, vi } from "vitest";

import { leaveSharedList, removeSharedUser, shareList } from "@/app/actions";
import { defaultSpaceId } from "@/lib/spaces";
import { flushAfter, prisma, setSessionUser } from "./setup";
import { formData, makeList, makeUser, shareList as seedShare } from "./factories";

describe("shareList", () => {
  it("создаёт ListShare в default-пространстве получателя", async () => {
    const owner = await makeUser();
    const recipient = await makeUser({ email: "recipient@test.local" });
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    const result = await shareList(
      formData({
        listId: list.id,
        email: "recipient@test.local",
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(true);
    const share = await prisma.listShare.findUniqueOrThrow({
      where: { listId_userId: { listId: list.id, userId: recipient.id } },
    });
    expect(share.spaceId).toBe(defaultSpaceId(recipient.id));
    expect(share.role).toBe("EDITOR");
  });

  it("возвращает данные добавленного пользователя", async () => {
    const owner = await makeUser();
    const recipient = await makeUser({ email: "friend@test.local", name: "Друг" });
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    const result = await shareList(
      formData({
        listId: list.id,
        email: "friend@test.local",
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(result).toMatchObject({
      success: true,
      user: { id: recipient.id, email: "friend@test.local", name: "Друг" },
    });
  });

  it("идемпотентен: повторная выдача не создаёт второй записи", async () => {
    const owner = await makeUser();
    await makeUser({ email: "recipient@test.local" });
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    const share = () =>
      shareList(
        formData({
          listId: list.id,
          email: "recipient@test.local",
          spaceId: owner.defaultSpaceId,
        }),
      );
    await share();
    await share();

    expect(await prisma.listShare.count({ where: { listId: list.id } })).toBe(1);
  });

  it("fail-closed отказывает, если у получателя нарушен инвариант default-space", async () => {
    const owner = await makeUser();
    const recipient = await prisma.user.create({
      data: { email: "without-space@test.local", name: "Без пространства" },
    });
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    const result = await shareList(
      formData({
        listId: list.id,
        email: recipient.email,
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(result).toEqual({
      success: false,
      error: "Не удалось предоставить доступ",
    });
    expect(await prisma.listShare.count()).toBe(0);
    expect(await prisma.space.count({ where: { userId: recipient.id } })).toBe(0);
  });

  it("нельзя поделиться с самим собой", async () => {
    const owner = await makeUser({ email: "me@test.local" });
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    const result = await shareList(
      formData({ listId: list.id, email: "me@test.local", spaceId: owner.defaultSpaceId }),
    );

    expect(result.success).toBe(false);
    expect(await prisma.listShare.count()).toBe(0);
  });

  it("нельзя поделиться списком, которым не владеешь", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    await makeUser({ email: "recipient@test.local" });
    const list = await makeList(owner.id, owner.defaultSpaceId);
    // other — не владелец, пытается расшарить чужой список из своего пространства.
    setSessionUser(other.id);

    const existingEmailResult = await shareList(
      formData({
        listId: list.id,
        email: "recipient@test.local",
        spaceId: other.defaultSpaceId,
      }),
    );
    const missingEmailResult = await shareList(
      formData({
        listId: list.id,
        email: "missing@test.local",
        spaceId: other.defaultSpaceId,
      }),
    );

    // Чужой listId не работает как oracle зарегистрированных email.
    expect(existingEmailResult).toEqual({
      success: false,
      error: "Не удалось предоставить доступ",
    });
    expect(missingEmailResult).toEqual(existingEmailResult);
    expect(await prisma.listShare.count()).toBe(0);
  });

  it("отклоняет несуществующий email", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    const result = await shareList(
      formData({
        listId: list.id,
        email: "nobody@test.local",
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(false);
    expect(await prisma.listShare.count()).toBe(0);
  });

  it("уведомляет участников списка после ответа", async () => {
    const owner = await makeUser();
    const recipient = await makeUser({ email: "recipient@test.local" });
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");

    await shareList(
      formData({
        listId: list.id,
        email: "recipient@test.local",
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledWith(
      [owner.id, recipient.id],
      null,
    );
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
  });
});

describe("removeSharedUser (действует владелец)", () => {
  it("владелец отзывает доступ у участника", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await seedShare(list.id, editor.id);
    setSessionUser(owner.id);

    const result = await removeSharedUser(
      formData({ listId: list.id, userId: editor.id, spaceId: owner.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(await prisma.listShare.count({ where: { listId: list.id } })).toBe(0);
  });

  it("участник не может отозвать доступ (это не его право)", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await seedShare(list.id, editor.id);
    // editor пытается действовать как владелец, передавая listId владельца.
    setSessionUser(editor.id);

    const result = await removeSharedUser(
      formData({ listId: list.id, userId: editor.id, spaceId: editor.defaultSpaceId }),
    );

    expect(result.success).toBe(false);
    // Доступ остался на месте: удаления не произошло.
    expect(await prisma.listShare.count({ where: { listId: list.id } })).toBe(1);
  });

  it("уведомляет удалённого и оставшихся участников без фонового DB-read", async () => {
    const owner = await makeUser();
    const removed = await makeUser();
    const remaining = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await seedShare(list.id, removed.id);
    await seedShare(list.id, remaining.id);
    setSessionUser(owner.id);
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");

    const result = await removeSharedUser(
      formData({
        listId: list.id,
        userId: removed.id,
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(result).toEqual({ success: true });
    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledOnce();
    const [userIds, socketId] = vi.mocked(notifyUsers).mock.calls[0];
    expect([...userIds].sort()).toEqual(
      [owner.id, removed.id, remaining.id].sort(),
    );
    expect(socketId).toBeNull();
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
  });
});

describe("leaveSharedList (действует участник)", () => {
  it("участник сам выходит из списка", async () => {
    const owner = await makeUser();
    const editor = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await seedShare(list.id, editor.id);
    setSessionUser(editor.id);

    const result = await leaveSharedList(
      formData({ listId: list.id, spaceId: editor.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(await prisma.listShare.count({ where: { listId: list.id } })).toBe(0);
  });

  it("выход удаляет только собственный share, не затрагивая других участников", async () => {
    const owner = await makeUser();
    const editorA = await makeUser();
    const editorB = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await seedShare(list.id, editorA.id);
    await seedShare(list.id, editorB.id);
    setSessionUser(editorA.id);
    const { notifyListMembers, notifyUsers } = await import("@/lib/notify");

    await leaveSharedList(
      formData({ listId: list.id, spaceId: editorA.defaultSpaceId }),
    );

    const remaining = await prisma.listShare.findMany({ where: { listId: list.id } });
    expect(remaining.map((s) => s.userId)).toEqual([editorB.id]);
    expect(vi.mocked(notifyUsers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyUsers)).toHaveBeenCalledOnce();
    const [userIds, socketId] = vi.mocked(notifyUsers).mock.calls[0];
    expect([...userIds].sort()).toEqual(
      [owner.id, editorA.id, editorB.id].sort(),
    );
    expect(socketId).toBeNull();
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
  });

  it("владелец не «выходит» из своего списка: share для него нет", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    const result = await leaveSharedList(
      formData({ listId: list.id, spaceId: owner.defaultSpaceId }),
    );

    expect(result.success).toBe(false);
    // Список остаётся: выход из чужого доступа не должен ничего удалять.
    expect(await prisma.list.findUnique({ where: { id: list.id } })).not.toBeNull();
  });
});

describe("изоляция sharing по пространству", () => {
  it("не выдаёт, не отзывает и не удаляет share через другой space", async () => {
    const owner = await makeUser();
    const editor = await makeUser({ email: "editor@test.local" });
    const ownerOtherSpace = await prisma.space.create({
      data: {
        userId: owner.id,
        name: "Другое",
        normalizedName: "другое",
      },
    });
    const editorOtherSpace = await prisma.space.create({
      data: {
        userId: editor.id,
        name: "Другое",
        normalizedName: "другое",
      },
    });
    const list = await makeList(owner.id, owner.defaultSpaceId);

    setSessionUser(owner.id);
    const shareResult = await shareList(
      formData({
        listId: list.id,
        email: editor.email,
        spaceId: ownerOtherSpace.id,
      }),
    );
    await seedShare(list.id, editor.id);
    const revokeResult = await removeSharedUser(
      formData({
        listId: list.id,
        userId: editor.id,
        spaceId: ownerOtherSpace.id,
      }),
    );

    setSessionUser(editor.id);
    const leaveResult = await leaveSharedList(
      formData({ listId: list.id, spaceId: editorOtherSpace.id }),
    );

    expect(shareResult).toEqual({
      success: false,
      error: "Не удалось предоставить доступ",
    });
    expect(revokeResult).toEqual({
      success: false,
      error: "Не удалось убрать доступ",
    });
    expect(leaveResult).toEqual({ success: false, error: "Список не найден" });
    expect(
      await prisma.listShare.findUnique({
        where: { listId_userId: { listId: list.id, userId: editor.id } },
      }),
    ).not.toBeNull();
  });
});
