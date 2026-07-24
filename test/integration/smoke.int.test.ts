/**
 * @file smoke.int.test.ts
 * @description Проверка самой обвязки: миграции накатились, моки на месте,
 *              truncate изолирует тесты. Если этот файл красный — красными
 *              будут и все остальные, но по неочевидной причине.
 */

import { describe, expect, it, vi } from "vitest";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { addItem } from "@/app/actions";
import { flushAfter, prisma, setSessionUser } from "./setup";
import { formData, makeList, makeUser } from "./factories";

describe("обвязка интеграционных тестов", () => {
  it("подключается к БД и применяет схему", async () => {
    const count = await prisma.user.count();
    expect(count).toBe(0);
  });

  it("auth замокан и управляется тестом", async () => {
    setSessionUser("user_1");
    expect(await auth()).toEqual({ user: { id: "user_1" } });
  });

  it("revalidatePath замокан (не бросает вне Next-контекста)", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    await addItem(
      formData({ itemName: "Молоко", listId: list.id, spaceId: user.defaultSpaceId }),
    );

    expect(vi.mocked(revalidatePath)).toHaveBeenCalled();
  });

  it("успешный Action пишет в реальную БД", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    const result = await addItem(
      formData({ itemName: "Хлеб", listId: list.id, spaceId: user.defaultSpaceId }),
    );

    expect(result).toEqual({ success: true });
    const items = await prisma.item.findMany({ where: { listId: list.id } });
    expect(items.map((i) => i.name)).toEqual(["Хлеб"]);
  });

  it("truncate изолирует: данные предыдущего теста не видны", async () => {
    // Предыдущие тесты создавали пользователей и записи — здесь их быть не должно.
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.item.count()).toBe(0);
  });

  it("after-колбэки копятся и выполняются только по flushAfter", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);
    setSessionUser(user.id);

    const { notifyListMembers } = await import("@/lib/notify");

    await addItem(
      formData({ itemName: "Сыр", listId: list.id, spaceId: user.defaultSpaceId }),
    );

    // До flushAfter Pusher-уведомление ещё не отправлено.
    expect(vi.mocked(notifyListMembers)).not.toHaveBeenCalled();
    await flushAfter();
    // socketId отсутствует в formData → null (вкладку-автора исключать не из чего).
    expect(vi.mocked(notifyListMembers)).toHaveBeenCalledWith(list.id, null);
  });
});
