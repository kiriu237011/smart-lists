/**
 * @file ci-container-confinement.test.ts
 * @description Статический контракт изоляции контейнеров CI (допущение A45).
 *
 * Дефолтные seccomp- и AppArmor-профили service-контейнеров достаются нам
 * даром: их ставит Docker, а не наш workflow. Поэтому единственное, что мы
 * можем с ними сделать, — молча снять одним флагом в `options:`, и в диффе
 * такая правка выглядит безобидной строкой рядом с healthcheck.
 *
 * Второе утверждение того же допущения: шаги job исполняются прямо на
 * одноразовой VM раннера, а не в контейнере. Именно её одноразовость, а не
 * профиль контейнера, служит границей для недоверенного кода зависимостей.
 * Появление `container:` меняет эту модель целиком и требует пересмотра A45,
 * а не молчаливого прохождения тестов.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowsDir = fileURLToPath(
  new URL("../.github/workflows", import.meta.url),
);

const workflows = readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => ({
    name,
    body: readFileSync(`${workflowsDir}/${name}`, "utf8"),
  }));

// Флаги `docker run`, снимающие дефолтные ограничения контейнера. Каждый по
// отдельности возвращает контейнеру часть прав хоста.
const WEAKENING_FLAGS = [
  "--privileged",
  "--security-opt",
  "--cap-add",
  "--userns",
  "--pid=host",
  "--device",
];

describe("изоляция контейнеров в CI", () => {
  it("видит workflow-файлы: иначе проверки ниже пройдут впустую", () => {
    expect(workflows.map((workflow) => workflow.name)).toContain("ci.yml");
  });

  it.each(workflows)(
    "$name не ослабляет профиль service-контейнеров",
    ({ body }) => {
      for (const flag of WEAKENING_FLAGS) {
        expect(body).not.toContain(flag);
      }
    },
  );

  it.each(workflows)("$name не выполняет шаги в контейнере", ({ body }) => {
    // Ключ job-уровня идёт с отступом в четыре пробела: `jobs:` → job → `container:`.
    expect(body).not.toMatch(/^ {4}container:/m);
  });
});
