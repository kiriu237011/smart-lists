/**
 * @file mutation-budget-coverage.test.ts
 * @description Полнота суточного бюджета мутаций (A29).
 *
 * Зачем отдельный статический контракт. `usage.int.test.ts` проверяет
 * поведение: перечисленное действие при исчерпанном бюджете отказывает. Но
 * список там ведётся руками, поэтому доказывает он ровно то, что в нём
 * перечислено, и ничего не говорит о полноте. Разница не теоретическая: до
 * 2026-09-01 строка A29 утверждала «новое действие без бюджета красит прогон»,
 * а `requestUpload`, `confirmUpload` и `deleteAttachment` уже полтора месяца
 * списывали бюджет, не будучи ни в одном тесте бюджета. Убери из них вызов —
 * прогон остался бы зелёным.
 *
 * Форма проверки выбрана по той же причине, по которой она выбрана в
 * `dependency-install-hooks.test.ts` и `workflow-action-pins.test.ts`: набор
 * берётся из источника факта — фактических экспортов каталога `actions`, — а не
 * из массива, который надо не забыть пополнить. Поэтому новый Server Action
 * попадает под проверку самим фактом своего появления.
 *
 * Fail-closed здесь означает инверсию умолчания: действие обязано списывать
 * бюджет, а исключение требует явной строки с причиной. Забыть добавить в
 * allowlist нельзя — тест назовёт функцию поимённо; забыть добавить в старый
 * ручной список было можно, и именно это произошло.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ACTIONS_DIR = path.resolve(process.cwd(), "src/app/actions");
const BUDGET_CALL = "consumeMutationBudget";

/**
 * Экспортируемые Server Actions, которые бюджет не списывают, и почему.
 *
 * Пустая строка причины недопустима: смысл allowlist в том, что исключение
 * объяснено, а не просто разрешено.
 */
const WITHOUT_BUDGET: Readonly<Record<string, string>> = {
  getSpaceDeleteImpact: "только читает счётчики для диалога подтверждения",
  rememberSpace: "пишет cookie последнего пространства, а не данные",
  getAttachmentUrl: "только выдаёт presigned GET на уже существующий объект",
  getListInsight: "расходует отдельную суточную квоту инсайтов (15/сутки)",
  enterGuestMode: "переключает cookie гостевого режима, БД не трогает",
  exitGuestMode: "снимает cookie гостевого режима, БД не трогает",
};

/** Тест поведения, который обязан покрывать каждое мутирующее действие. */
const BEHAVIOUR_TEST = "test/integration/usage.int.test.ts";

type ActionFn = { name: string; file: string; body: string };

/** Разбирает файл на экспортируемые функции вместе с телами. */
function exportedActions(file: string): ActionFn[] {
  const source = readFileSync(path.join(ACTIONS_DIR, file), "utf8");
  const marker = /^export async function (\w+)/gm;
  const found: Array<{ name: string; start: number }> = [];

  for (const match of source.matchAll(marker)) {
    found.push({ name: match[1], start: match.index });
  }

  return found.map((entry, index) => ({
    name: entry.name,
    file,
    // Тело — до следующего экспорта: точный разбор скобок здесь не нужен,
    // проверяется лишь наличие вызова внутри границ функции.
    body: source.slice(entry.start, found[index + 1]?.start ?? source.length),
  }));
}

const actionFiles = readdirSync(ACTIONS_DIR).filter((name) =>
  name.endsWith(".ts"),
);
const actions = actionFiles.flatMap(exportedActions);
const withBudget = actions.filter((action) => action.body.includes(BUDGET_CALL));

describe("полнота суточного бюджета мутаций", () => {
  it("видит все файлы actions и хотя бы один экспорт в каждом", () => {
    // Сторож самого разбора: опечатка в пути или regex обнулила бы набор, и
    // все проверки ниже стали бы тавтологией на пустом множестве.
    expect(actionFiles.sort()).toEqual([
      "attachments.ts",
      "guest.ts",
      "index.ts",
      "insights.ts",
      "spaces.ts",
    ]);
    for (const file of actionFiles) {
      expect(exportedActions(file).length, file).toBeGreaterThan(0);
    }
  });

  it("не допускает Server Action без бюджета вне allowlist", () => {
    const unexplained = actions
      .filter((action) => !action.body.includes(BUDGET_CALL))
      .filter((action) => !(action.name in WITHOUT_BUDGET))
      .map((action) => `${action.file}:${action.name}`);

    expect(unexplained).toEqual([]);
  });

  it("требует непустую причину у каждого исключения", () => {
    for (const [name, reason] of Object.entries(WITHOUT_BUDGET)) {
      expect(reason.trim().length, name).toBeGreaterThan(0);
    }
  });

  it("не оставляет в allowlist исчезнувшие или начавшие списывать функции", () => {
    // Иначе allowlist накапливает мёртвые строки и постепенно перестаёт
    // означать «эти действия проверены и признаны безбюджетными».
    const stale = Object.keys(WITHOUT_BUDGET).filter((name) => {
      const action = actions.find((entry) => entry.name === name);
      return action === undefined || action.body.includes(BUDGET_CALL);
    });

    expect(stale).toEqual([]);
  });

  it("покрывает каждое мутирующее действие тестом поведения", () => {
    const behaviour = readFileSync(
      path.resolve(process.cwd(), BEHAVIOUR_TEST),
      "utf8",
    );

    // Имена берутся и из табличного массива, и из отдельных `it`: два действия
    // ничего не возвращают клиенту, поэтому проверяются по данным отдельно.
    // `\s*` обязателен: длинные записи массива Prettier переносит, и имя
    // уезжает на следующую строку после открывающей скобки.
    const covered = new Set<string>();
    for (const match of behaviour.matchAll(/\[\s*"(\w+)"\s*,/g)) covered.add(match[1]);
    for (const match of behaviour.matchAll(/\bit\("(\w+) /g)) covered.add(match[1]);

    // Сторож самого разбора. Если regex сломается и начнёт «находить» что
    // угодно, проверка ниже станет тавтологией и промолчит — ровно тот способ
    // отказа, из-за которого A29 полтора месяца считалась закрытой.
    expect(covered.has("addItem")).toBe(true);
    expect(covered.has("несуществующееДействие")).toBe(false);

    const uncovered = withBudget
      .map((action) => action.name)
      .filter((name) => !covered.has(name))
      .sort();

    expect(uncovered).toEqual([]);
  });
});
