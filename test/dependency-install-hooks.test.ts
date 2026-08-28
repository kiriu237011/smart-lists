/**
 * @file dependency-install-hooks.test.ts
 * @description Статический контракт установки зависимостей (допущение A51).
 *
 * `preinstall`/`postinstall` исполняются от самого факта установки — до любого
 * импорта, до любого теста и до того, как кто-либо прочитает дифф. В нашем
 * дереве 889 пакетов при 38 прямых, поэтому защитой служит не ревью, а флаг.
 *
 * Проверка репозиторная, а не пофайловая, и это главное в ней. `ci.yml` был
 * переведён на `--ignore-scripts` целиком, а `sync-preview.yml` остался с голым
 * `npm ci` и не попал ни в чей обзор: в THREAT_MODEL.md строка A51 больше
 * полусуток утверждала «все четыре job», пока установок было пять. Причём
 * пропущенной оказалась худшая из них — единственная с write-token и боевым
 * `DIRECT_URL`. Отсюда форма теста: он смотрит на все workflow сразу, чтобы
 * новый job не мог добавить установку с хуками незаметно.
 *
 * Второй раз та же ошибка повторилась на уровень выше и была найдена аудитом
 * 2026-08-28. Тест закрывал каталог workflow целиком и потому считался полным,
 * но установок в проекте не пять, а шесть: шестую выполняет сборщик Vercel, и
 * `vercel.json` — не workflow, поэтому в область проверки не попадал. Хуки там
 * исполнялись. Отсюда правило: контракт описывает **все места, где ставятся
 * зависимости**, а не один каталог. Сейчас таких мест два, и оба перечислены
 * ниже явно — новое придётся добавить сюда руками, но тогда об этом хотя бы
 * будет видно из диффа.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workflowsDir = `${repoRoot}.github/workflows`;

const packageJson = JSON.parse(
  readFileSync(`${repoRoot}package.json`, "utf8"),
) as { scripts?: Record<string, string> };

// Комментарии отбрасываются до разбора: контракт описывает то, что исполняется.
// Иначе упоминание команды в пояснении рядом ломает проверку — ровно так этот
// тест и упал впервые, поймав `npm ci` из комментария в `sync-preview.yml`.
const withoutComments = (body: string) =>
  body
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const workflows = readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({
    name,
    body: withoutComments(readFileSync(`${workflowsDir}/${name}`, "utf8")),
  }));

// Любой вызов npm, который ставит зависимости и потому запускает хуки.
const INSTALL_COMMAND = /\bnpm\s+(ci|install|i)\b[^\n]*/g;

describe("установка зависимостей не исполняет чужой код", () => {
  it("видит workflow: иначе проверки ниже пройдут впустую", () => {
    expect(workflows.map((file) => file.name)).toContain("ci.yml");
    expect(workflows.map((file) => file.name)).toContain("sync-preview.yml");
    expect(workflows.map((file) => file.name)).toContain("audit-database.yml");
    expect(workflows.map((file) => file.name)).toContain("configure-preview-rls.yml");
  });

  it.each(workflows)("$name ставит зависимости без хуков", ({ body }) => {
    const installs = [...body.matchAll(INSTALL_COMMAND)].map(
      (match) => match[0],
    );

    for (const install of installs) {
      expect(install).toContain("--ignore-scripts");
    }
  });

  // Предыдущая проверка проходит и на пустом списке совпадений, поэтому здесь
  // требуется, чтобы выражение действительно находило установки там, где они
  // заведомо есть. Иначе сломанный regexp сделал бы контракт зелёным и пустым.
  it.each([
    "ci.yml",
    "sync-preview.yml",
    "audit-database.yml",
    "configure-preview-rls.yml",
  ])("в %s установки найдены", (name) => {
    const file = workflows.find((candidate) => candidate.name === name);
    expect([...(file?.body ?? "").matchAll(INSTALL_COMMAND)]).not.toHaveLength(
      0,
    );
  });
});

describe("сборка на Vercel ставит зависимости без хуков", () => {
  const vercel = JSON.parse(
    readFileSync(`${repoRoot}vercel.json`, "utf8"),
  ) as Partial<{ installCommand: string; buildCommand: string }>;

  // Умолчание Vercel — установка с хуками. Пока команда не задана явно,
  // контроль на этой поверхности отсутствует, и отсутствует молча: в диффе
  // видно только то, что строки нет.
  it("задаёт installCommand явно и без install-хуков", () => {
    expect(vercel.installCommand).toBeDefined();

    const installs = [
      ...(vercel.installCommand ?? "").matchAll(INSTALL_COMMAND),
    ].map((match) => match[0]);

    expect(installs).not.toHaveLength(0);
    for (const install of installs) {
      expect(install).toContain("--ignore-scripts");
    }
  });

  // Следствие предыдущего: `--ignore-scripts` гасит и наш собственный
  // postinstall, поэтому генерация клиента обязана быть вызвана явно. Без этой
  // проверки контракт можно было бы «починить» удалением postinstall — сборка
  // сломалась бы, — или вернуть хуки, чтобы сборка снова заработала.
  it("компенсирует погашенный postinstall явной генерацией", () => {
    expect(packageJson.scripts?.postinstall).toBe("prisma generate");
    expect(vercel.buildCommand).toContain("prisma generate");
  });
});
