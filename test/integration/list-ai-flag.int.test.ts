/**
 * @file list-ai-flag.int.test.ts
 * @description Флаг `aiEnabled` на списке: кто может его менять и что он даёт.
 *
 * Смысл флага — в правах на него. Он защищает содержимое участника, который
 * список не создавал; проверка на владельца оставила бы такого человека без
 * средств вообще. Поэтому центральный тест здесь — не «флаг сохраняется», а
 * «выключить может не владелец».
 *
 * Отказ самого инсайта проверяется отдельно: спрятанной кнопки недостаточно,
 * Action вызывается напрямую.
 */

import { describe, expect, it, vi } from "vitest";

import { setListAiEnabled } from "@/app/actions";
import { getListInsight } from "@/app/actions/insights";
import { prisma, setSessionUser } from "./setup";
import { formData, makeList, makeUser, shareList } from "./factories";

vi.mock("@/lib/gcp-auth", () => ({
  getCloudRunIdToken: vi.fn(async () => "test-id-token"),
}));

/** Текущее состояние флага в базе. */
async function storedFlag(listId: string): Promise<boolean | undefined> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { aiEnabled: true },
  });
  return list?.aiEnabled;
}

describe("переключение AI для списка", () => {
  it("новый список создаётся с включённым AI", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);

    // Умолчание принадлежит схеме, а не Action: выключенный по умолчанию флаг
    // молча поменял бы поведение уже существующих списков.
    expect(await storedFlag(list.id)).toBe(true);
  });

  it("владелец выключает и включает обратно", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    expect(
      await setListAiEnabled(
        formData({ listId: list.id, aiEnabled: "false", spaceId: owner.defaultSpaceId }),
      ),
    ).toEqual({ success: true });
    expect(await storedFlag(list.id)).toBe(false);

    await setListAiEnabled(
      formData({ listId: list.id, aiEnabled: "true", spaceId: owner.defaultSpaceId }),
    );
    expect(await storedFlag(list.id)).toBe(true);
  });

  it("участник, не являющийся владельцем, тоже может выключить", async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    const memberSpaceId = await shareList(list.id, member.id).then((s) => s.spaceId);
    setSessionUser(member.id);

    // Ради этого флаг и заведён: содержимое участника уходит наружу по чужому
    // нажатию, и запретить это он должен уметь сам.
    const result = await setListAiEnabled(
      formData({ listId: list.id, aiEnabled: "false", spaceId: memberSpaceId }),
    );

    expect(result).toEqual({ success: true });
    expect(await storedFlag(list.id)).toBe(false);
  });

  it("посторонний не может изменить флаг", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(stranger.id);

    const result = await setListAiEnabled(
      formData({
        listId: list.id,
        aiEnabled: "false",
        spaceId: stranger.defaultSpaceId,
      }),
    );

    expect(result.success).toBe(false);
    expect(await storedFlag(list.id)).toBe(true);
  });

  it("непонятное значение флага отвергается, а не толкуется", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    setSessionUser(owner.id);

    // «Всё, кроме false — истина» означало бы молча включённый AI на опечатке.
    const result = await setListAiEnabled(
      formData({ listId: list.id, aiEnabled: "yes", spaceId: owner.defaultSpaceId }),
    );

    expect(result.success).toBe(false);
    expect(await storedFlag(list.id)).toBe(true);
  });
});

describe("инсайт при выключенном AI", () => {
  it("отказывает владельцу", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await prisma.list.update({
      where: { id: list.id },
      data: { aiEnabled: false },
    });
    setSessionUser(owner.id);

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await getListInsight(list.id, undefined, owner.defaultSpaceId);

    expect(result).toEqual({ error: "aiDisabled" });
    // Главное здесь: наружу ничего не ушло. Спрятанная кнопка запрет не
    // обеспечивает — Action вызывается напрямую.
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("не тратит суточную квоту инсайтов", async () => {
    const owner = await makeUser();
    const list = await makeList(owner.id, owner.defaultSpaceId);
    await prisma.list.update({
      where: { id: list.id },
      data: { aiEnabled: false },
    });
    setSessionUser(owner.id);

    await getListInsight(list.id, undefined, owner.defaultSpaceId);

    // Запрет — не ошибка пользователя, и списывать за него квоту неправильно.
    const usage = await prisma.userDailyUsage.findFirst({
      where: { userId: owner.id },
      select: { insights: true },
    });
    expect(usage?.insights ?? 0).toBe(0);
  });
});
