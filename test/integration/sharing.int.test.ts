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

    const result = await shareList(
      formData({
        listId: list.id,
        email: "recipient@test.local",
        spaceId: other.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(false);
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
    await makeUser({ email: "recipient@test.local" });
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);
    const { notifyListMembers } = await import("@/lib/notify");

    await shareList(
      formData({
        listId: list.id,
        email: "recipient@test.local",
        spaceId: owner.defaultSpaceId,
      }),
    );

    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
    await flushAfter();
    expect(vi.mocked(notifyListMembers)).toHaveBeenCalledWith(list.id, null);
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

    await leaveSharedList(
      formData({ listId: list.id, spaceId: editorA.defaultSpaceId }),
    );

    const remaining = await prisma.listShare.findMany({ where: { listId: list.id } });
    expect(remaining.map((s) => s.userId)).toEqual([editorB.id]);
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
