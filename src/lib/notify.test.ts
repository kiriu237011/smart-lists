/**
 * @file notify.test.ts
 * @description Тесты рассылки realtime-уведомлений участникам списков.
 *
 * Почему эти тесты существуют. Логика `notify.ts` не исполняется больше нигде:
 * интеграционные тесты подменяют модуль целиком (`test/integration/setup.ts`),
 * а E2E не поднимает Pusher вовсе — ключ там фиктивный, клиент не подключается
 * (`test/e2e/env.ts`). Решение не гонять настоящий Pusher правильное: это
 * внешний сервис. Но оно закрывает вопрос транспорта, а не вопрос адресатов —
 * разрешение получателей и валидация `socket_id` к сети не обращаются вовсе.
 *
 * Цена ошибки здесь выше обычной: отказ рассылки ничего не ломает на экране
 * автора действия — он получает свежий RSC-payload из ответа Server Action.
 * Молча перестают обновляться вкладки ОСТАЛЬНЫХ участников, а для них это
 * неотличимо от «у него ничего не поменялось». В логе останется одна строка.
 *
 * `@/lib/db` и `@/lib/pusher-server` создают клиента прямо на импорте, поэтому
 * подменяются оба. Логгер подменён, чтобы ожидаемые ошибки не засоряли вывод.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  // Сигнатура объявлена типом, а не телом: без параметров кортеж вызова
  // выводится пустым и обращение к `calls[0][3]` не компилируется, а
  // именованные заглушки параметров дали бы предупреждения линтера.
  trigger: vi.fn<
    (
      channel: string,
      event: string,
      data: unknown,
      params?: { socket_id: string },
    ) => Promise<void>
  >(async () => {}),
  logError: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: { list: { findUnique: mocks.findUnique, findMany: mocks.findMany } },
}));

vi.mock("@/lib/pusher-server", () => ({
  pusherServer: { trigger: mocks.trigger },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
  hashId: (id: string) => id,
}));

const { notifyListMembers, notifyListsMembers, notifyUsers } = await import(
  "@/lib/notify"
);

/** Каналы, в которые ушло событие, в порядке вызовов. */
function notifiedChannels(): string[] {
  return mocks.trigger.mock.calls.map((call) => call[0]);
}

/** Четвёртый аргумент `trigger` — параметры исключения вкладки-автора. */
function triggerParams(): { socket_id: string } | undefined {
  return mocks.trigger.mock.calls[0]?.[3];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyListMembers", () => {
  it("уведомляет владельца и всех получателей share", async () => {
    mocks.findUnique.mockResolvedValue({
      ownerId: "user_owner",
      shares: [{ userId: "user_editor_1" }, { userId: "user_editor_2" }],
    });

    await notifyListMembers("list_1");

    // Каждому — свой private-канал: подписку на чужой отклонит /api/pusher/auth.
    expect(notifiedChannels()).toEqual([
      "private-user-user_owner",
      "private-user-user_editor_1",
      "private-user-user_editor_2",
    ]);
  });

  it("шлёт событие refresh без полезной нагрузки", async () => {
    mocks.findUnique.mockResolvedValue({ ownerId: "user_owner", shares: [] });

    await notifyListMembers("list_1");

    // Содержимое едет следующим RSC-payload, а не через Pusher: канал общий на
    // пользователя, и класть в него данные списка означало бы рассылать их
    // тем, у кого может не быть доступа к конкретному списку.
    expect(mocks.trigger).toHaveBeenCalledWith(
      "private-user-user_owner",
      "refresh",
      {},
      undefined,
    );
  });

  it("не задваивает владельцу, который заодно значится в share", async () => {
    mocks.findUnique.mockResolvedValue({
      ownerId: "user_owner",
      shares: [{ userId: "user_owner" }, { userId: "user_editor" }],
    });

    await notifyListMembers("list_1");

    expect(notifiedChannels()).toEqual([
      "private-user-user_owner",
      "private-user-user_editor",
    ]);
  });

  it("на исчезнувшем списке не шлёт ничего", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await notifyListMembers("list_gone");

    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("сбой запроса к БД не пробрасывается наружу", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db down"));

    // Мутация к этому моменту уже завершена: упавшее уведомление не должно
    // превращаться в ошибку Server Action и откатывать её на клиенте.
    await expect(notifyListMembers("list_1")).resolves.toBeUndefined();
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe("notifyListsMembers", () => {
  it("объединяет получателей двух списков и не задваивает общего участника", async () => {
    // Ради этого случая функция и появилась: перенос записи между списками
    // затрагивает оба, а два отдельных notifyListMembers дали бы участнику
    // обоих списков два refresh подряд — то есть двойной router.refresh().
    mocks.findMany.mockResolvedValue([
      { ownerId: "user_owner", shares: [{ userId: "user_both" }] },
      { ownerId: "user_other", shares: [{ userId: "user_both" }] },
    ]);

    await notifyListsMembers(["list_from", "list_to"]);

    expect(notifiedChannels()).toEqual([
      "private-user-user_owner",
      "private-user-user_both",
      "private-user-user_other",
    ]);
  });

  it("схлопывает повторяющиеся ID списков до запроса в БД", async () => {
    mocks.findMany.mockResolvedValue([{ ownerId: "user_owner", shares: [] }]);

    // Перенос внутри одного списка приходит сюда парой одинаковых ID.
    await notifyListsMembers(["list_1", "list_1"]);

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["list_1"] } },
      }),
    );
    expect(notifiedChannels()).toEqual(["private-user-user_owner"]);
  });

  it("на пустой выборке не шлёт ничего", async () => {
    mocks.findMany.mockResolvedValue([]);

    await notifyListsMembers(["list_gone"]);

    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("сбой запроса к БД не пробрасывается наружу", async () => {
    mocks.findMany.mockRejectedValue(new Error("db down"));

    await expect(notifyListsMembers(["list_1"])).resolves.toBeUndefined();
    expect(mocks.logError).toHaveBeenCalled();
  });
});

describe("notifyUsers — исключение вкладки-автора", () => {
  it("пробрасывает корректный socket_id в параметры рассылки", async () => {
    await notifyUsers(["user_1"], "123456.789012");

    expect(triggerParams()).toEqual({ socket_id: "123456.789012" });
  });

  // Значение приходит от клиента, поэтому проверяется формат, а не доверие.
  // Pusher на мусорном socket_id бросает, и рассылка не ушла бы ВООБЩЕ — ни
  // автору, ни остальным. Поэтому невалидное значение обязано вырождаться в
  // «не исключать никого», а не ломать доставку: лишний refresh у автора
  // безобиден, молчание у остальных — нет.
  it.each([
    ["чужой формат", "not-a-socket-id"],
    ["пустая строка", ""],
    ["только цифры без точки", "123456"],
    ["точка без второй части", "123456."],
    ["инъекция после валидного префикса", "123456.789012 OR 1=1"],
  ])("невалидный socket_id (%s) не отменяет рассылку", async (_case, value) => {
    await notifyUsers(["user_1"], value);

    expect(notifiedChannels()).toEqual(["private-user-user_1"]);
    expect(triggerParams()).toBeUndefined();
  });

  it("нестроковое значение тоже вырождается в отсутствие исключения", async () => {
    await notifyUsers(["user_1"], { socket_id: "123456.789012" });

    expect(notifiedChannels()).toEqual(["private-user-user_1"]);
    expect(triggerParams()).toBeUndefined();
  });

  it("отсутствие socket_id оставляет рассылку всем", async () => {
    await notifyUsers(["user_1", "user_2"]);

    expect(notifiedChannels()).toEqual([
      "private-user-user_1",
      "private-user-user_2",
    ]);
    expect(triggerParams()).toBeUndefined();
  });

  it("сбой Pusher не пробрасывается наружу", async () => {
    mocks.trigger.mockRejectedValueOnce(new Error("pusher down"));

    await expect(notifyUsers(["user_1"])).resolves.toBeUndefined();
    expect(mocks.logError).toHaveBeenCalled();
  });
});
