/**
 * @file dependency-install-hooks.test.ts
 * @description Статический контракт установки зависимостей (допущение A51).
 *
 * `preinstall`/`postinstall` исполняются от самого факта установки — до любого
 * импорта, до любого теста и до того, как кто-либо прочитает дифф. В нашем
 * дереве 906 пакетов при 38 прямых, поэтому защитой служит не ревью, а флаг.
 *
 * Проверка репозиторная, а не пофайловая, и это главное в ней. `ci.yml` был
 * переведён на `--ignore-scripts` целиком, а `sync-preview.yml` остался с голым
 * `npm ci` и не попал ни в чей обзор: в THREAT_MODEL.md строка A51 больше
 * полусуток утверждала «все четыре job», пока установок было пять. Причём
 * пропущенной оказалась худшая из них — единственная с write-token и боевым
 * `DIRECT_URL`. Отсюда форма теста: он смотрит на все workflow сразу, чтобы
 * новый job не мог добавить установку с хуками незаметно.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workflowsDir = `${repoRoot}.github/workflows`;

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
  it.each(["ci.yml", "sync-preview.yml", "audit-database.yml"])("в %s установки найдены", (name) => {
    const file = workflows.find((candidate) => candidate.name === name);
    expect([...(file?.body ?? "").matchAll(INSTALL_COMMAND)]).not.toHaveLength(
      0,
    );
  });
});
