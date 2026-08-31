/**
 * @file tls-contract.test.ts
 * @description Контракт транспорта: минимальная версия TLS у рантайма и
 * полнота проверки строк подключения во всех workflow.
 *
 * Проверено 2026-08-31 внешними пробами: Vercel, Neon, S3, Cloud Run и
 * Anthropic принимают только TLS 1.2/1.3, а Neon отвергает нешифрованное
 * соединение сам. Ни одна из этих гарантий не наша — все они держатся на
 * дефолтах платформ. Здесь закрепляется то, что зависит от нас: версия,
 * которую соглашается использовать наш собственный клиент, и обязательность
 * проверки сертификата на libpq-путях.
 */

import { readFileSync, readdirSync } from "node:fs";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** Версии по возрастанию — сравнивать строки напрямую нельзя. */
const TLS_VERSIONS = ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"];

const workflowsDir = fileURLToPath(
  new URL("../.github/workflows", import.meta.url),
);

const workflows = readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({
    name,
    body: readFileSync(workflowsDir + "/" + name, "utf8"),
  }));

describe("минимальная версия TLS", () => {
  it("рантайм не соглашается на версии ниже 1.2", () => {
    // `ws-ap1.pusher.com` до сих пор принимает TLS 1.0 и 1.1 — проверено
    // handshake-пробой. Недостижимо это только потому, что наш клиент туда не
    // пойдёт: Node держит минимум на 1.2 сам. Тест ловит смену этого дефолта
    // при обновлении рантайма, а не гипотетическое ослабление чужого сервиса.
    expect(TLS_VERSIONS.indexOf(tls.DEFAULT_MIN_VERSION)).toBeGreaterThanOrEqual(
      TLS_VERSIONS.indexOf("TLSv1.2"),
    );
  });
});

describe("проверка сертификата на libpq-путях", () => {
  it("каталог workflow прочитан", () => {
    // Пустой список сделал бы контракт ниже бессмысленно зелёным.
    expect(workflows.length).toBeGreaterThan(0);
  });

  it("каждый потребитель DIRECT_URL проверяет sslmode", () => {
    // Форма выбрана по уроку A51: контракт описывает все места, где строка
    // подключения попадает к libpq-клиенту, а не перечисленные поимённо файлы.
    // Новый workflow с `secrets.DIRECT_URL` обязан либо звать общий скрипт,
    // либо нести собственный guard — иначе он покраснеет здесь.
    const consumers = workflows.filter(({ body }) =>
      body.includes("secrets.DIRECT_URL"),
    );

    expect(consumers.length).toBeGreaterThan(0);

    for (const { name, body } of consumers) {
      const guarded =
        body.includes("verify-release-database.mjs") ||
        body.includes("sslmode=verify-full");
      expect(guarded, name).toBe(true);
    }
  });
});

describe("realtime-транспорт", () => {
  it("серверный Pusher-клиент требует TLS", () => {
    // Вторая половина гарантии — Force TLS в дашборде Pusher — находится вне
    // репозитория и проверяется вручную (A17). Эта половина наша.
    const source = readFileSync(
      fileURLToPath(new URL("../src/lib/pusher-server.ts", import.meta.url)),
      "utf8",
    );

    expect(source).toContain("useTLS: true");
  });
});
