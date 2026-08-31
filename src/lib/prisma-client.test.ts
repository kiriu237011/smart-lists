/**
 * @file prisma-client.test.ts
 * @description Контракт транспорта до PostgreSQL: приложение не подключается к
 * удалённой базе без проверки сертификата.
 *
 * Контроль существует потому, что значение `DATABASE_URL` живёт в окружении
 * Vercel: оно не проходит ни ревью, ни CI, а прочитать его нельзя — переменная
 * помечена Sensitive. Раньше единственным сигналом о слабом режиме было
 * предупреждение `pg` в рантайм-логах, и оно исчезнет ровно тогда, когда
 * трактовка `sslmode` в `pg` 9 сменится на libpq-семантику и защита пропадёт.
 */

import { describe, expect, it } from "vitest";

import { assertSecureDatabaseUrl, createPrismaClient } from "@/lib/prisma-client";

const REMOTE = "postgresql://smartlists_runtime:secret@ep-prod-pooler.ap-southeast-1.aws.neon.tech/neondb";

describe("assertSecureDatabaseUrl", () => {
  it("принимает удалённую базу с verify-full", () => {
    expect(() =>
      assertSecureDatabaseUrl(REMOTE + "?sslmode=verify-full&channel_binding=require"),
    ).not.toThrow();
  });

  it.each([
    ["postgresql://postgres:postgres@localhost:5432/smartlists_test"],
    ["postgresql://ci:ci@127.0.0.1:5432/ci"],
    ["postgresql://ci:ci@[::1]:5432/ci"],
    ["postgres://postgres:postgres@localhost:5433/smartlists_e2e_test"],
  ])("не требует TLS от локальной базы: %s", (url) => {
    // Освобождение существует ради интеграционных и E2E прогонов: все
    // `DATABASE_URL` в `ci.yml` указывают на localhost или 127.0.0.1.
    expect(() => assertSecureDatabaseUrl(url)).not.toThrow();
  });

  it.each([
    ["require"],
    ["prefer"],
    ["verify-ca"],
    ["disable"],
    ["no-verify"],
  ])("отвергает удалённую базу с sslmode=%s", (mode) => {
    expect(() => assertSecureDatabaseUrl(REMOTE + "?sslmode=" + mode)).toThrow();
  });

  it("отвергает удалённую базу без sslmode", () => {
    // Без параметра node-postgres не включает TLS вовсе — это не строгий
    // дефолт, а открытое соединение.
    expect(() => assertSecureDatabaseUrl(REMOTE)).toThrow();
  });

  it("отвергает uselibpqcompat даже рядом с verify-full", () => {
    // Флаг переключает драйвер в семантику libpq немедленно; оставлять его
    // «на всякий случай» нельзя, потому что рядом легко окажется require.
    expect(() =>
      assertSecureDatabaseUrl(REMOTE + "?uselibpqcompat=true&sslmode=verify-full"),
    ).toThrow();
  });

  it("отвергает verify-full в другом регистре", () => {
    // Драйвер сверяет значение точно, поэтому `Verify-Full` он не распознает
    // и TLS не включит. Принять такую строку значило бы солгать.
    expect(() => assertSecureDatabaseUrl(REMOTE + "?sslmode=Verify-Full")).toThrow();
  });

  it.each([
    [""],
    ["not-a-url"],
    ["https://ep-prod.ap-southeast-1.aws.neon.tech/neondb"],
  ])("fail-closed для некорректной строки %#", (url) => {
    expect(() => assertSecureDatabaseUrl(url)).toThrow();
  });

  it("не раскрывает содержимое строки в сообщении об ошибке", () => {
    // В строке лежит пароль роли, а сообщение уходит в логи платформы.
    try {
      assertSecureDatabaseUrl(REMOTE + "?sslmode=require");
      expect.unreachable("ожидалась ошибка");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("secret");
      expect(message).not.toContain("neon.tech");
    }
  });
});

describe("createPrismaClient", () => {
  it("не создаёт клиент на строке без verify-full", () => {
    // Проверка именно подключённости контроля: чистая функция может быть
    // сколь угодно строгой, если её никто не вызывает.
    expect(() => createPrismaClient(REMOTE + "?sslmode=require")).toThrow();
  });

  it("по-прежнему отвергает пустую строку", () => {
    expect(() => createPrismaClient("   ")).toThrow();
  });
});
