/**
 * @file app-settings.int.test.ts
 * @description Гейт гостевого режима: только явное «true» открывает вход.
 *
 * Почему это проверяется отдельно. `isGuestModeEnabled` — единственный
 * переключатель, открывающий приложение без авторизации, и все его ветки, кроме
 * одной, ведут в отказ. E2E проверяет ровно эту одну (`guest.e2e.ts`, значение
 * `false`), а отсутствие строки, постороннее значение и сбой запроса — то, что
 * происходит на самом деле при ошибке администрирования или недоступной БД, —
 * не проверял никто.
 *
 * Проверка идёт против настоящей БД: функция состоит из одного запроса Prisma,
 * и на моке она проверяла бы сам мок. Пишет строку `adminPrisma` — runtime-роль
 * `AppSetting` не изменяет, а тест не должен зависеть от её прав.
 */

import { describe, expect, it, vi } from "vitest";

import { isGuestModeEnabled } from "@/lib/app-settings";
import { adminPrisma, prisma } from "./setup";

/** Кладёт настройку гостевого режима с заданным значением. */
async function setGuestMode(value: string) {
  await adminPrisma.appSetting.create({
    data: { key: "guestModeEnabled", value },
  });
}

describe("isGuestModeEnabled", () => {
  it("разрешает вход при явном значении true", async () => {
    await setGuestMode("true");

    expect(await isGuestModeEnabled()).toBe(true);
  });

  it("запрещает вход, когда строки настройки нет вовсе", async () => {
    // Состояние по умолчанию: свежая база и любая среда, где настройку не
    // заводили. Умолчание обязано быть закрытым, а не открытым.
    expect(await isGuestModeEnabled()).toBe(false);
  });

  it("запрещает вход при явном false", async () => {
    await setGuestMode("false");

    expect(await isGuestModeEnabled()).toBe(false);
  });

  // Сравнение строгое и регистрозависимое. Толковать «похожее на истину» как
  // истину здесь нельзя: настройка правится руками через SQL, и опечатка
  // администратора открыла бы приложение целиком.
  it.each(["TRUE", "True", "1", "yes", "on", "enabled", " true", "true "])(
    "не толкует значение %j как разрешение",
    async (value) => {
      await setGuestMode(value);

      expect(await isGuestModeEnabled()).toBe(false);
    },
  );

  it("запрещает вход при сбое запроса к БД", async () => {
    // Страница входа не должна падать из-за недоступной базы, но и открываться
    // она в этот момент не должна: недоступность БД — не согласие.
    const findUnique = vi
      .spyOn(prisma.appSetting, "findUnique")
      .mockRejectedValueOnce(new Error("db down"));

    try {
      expect(await isGuestModeEnabled()).toBe(false);
      expect(findUnique).toHaveBeenCalled();
    } finally {
      findUnique.mockRestore();
    }
  });
});
