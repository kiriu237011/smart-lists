/**
 * @file action-auth-boundary.test.ts
 * @description Проверка сессии до обращения к данным в каждом Server Action.
 *
 * Server Action — это публичный HTTP-эндпоинт: вызвать его может кто угодно, а
 * не только та кнопка, ради которой он написан. Поэтому «проверяй авторизацию
 * до защищённых операций» из `AGENTS.md` — не стилистическое правило, а
 * граница доверия. Забытый `auth()` в новом действии выглядит в диффе как
 * отсутствующая строка, то есть не выглядит никак.
 *
 * Проверяется не только наличие вызова, но и его позиция. Порядок здесь и есть
 * контроль: `auth()` после первого запроса к БД означает, что данные уже
 * прочитаны — на вопрос «кто спрашивает» ответили после того, как ответили на
 * сам вопрос. Такой Action «содержит auth()» и при этом дыряв.
 *
 * Форма та же, что у `mutation-budget-coverage.test.ts` и
 * `outbound-requests.test.ts`: набор берётся из фактических экспортов каталога,
 * поэтому новое действие попадает под проверку самим фактом появления, а
 * исключение требует явной строки с причиной.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ACTIONS_DIR = path.resolve(process.cwd(), "src/app/actions");

const AUTH_CALL = "await auth()";

/**
 * Ранний выход: без него `auth()` — просто чтение сессии, а не проверка.
 *
 * Форма записи в коде разная и это нормально: `!session?.user?.id`,
 * развёрнутое `!session || !session.user || !session.user.id`, условие с
 * дополнительной проверкой. Детектор поэтому опирается на начало условия, а не
 * на точную строку — иначе он падал бы на обычном рефакторинге, то есть учил
 * бы писать под тест вместо того, чтобы проверять контроль.
 */
const SESSION_GUARD = /if\s*\(\s*!session\b/;

/** Позиция раннего выхода по сессии, либо -1. */
function sessionGuardAt(body: string): number {
  return body.search(SESSION_GUARD);
}

/**
 * Первое обращение к данным пользователя. `consumeMutationBudget` входит сюда
 * намеренно: он пишет в БД по userId, поэтому тоже относится к «после auth».
 */
const DATA_ACCESS = [
  "withSpaceDb",
  "withUserDb",
  "prisma.",
  "consumeMutationBudget",
] as const;

/**
 * Server Actions без проверки сессии и почему.
 * Пустая причина недопустима: исключение должно быть объяснено.
 */
const WITHOUT_AUTH: Readonly<Record<string, string>> = {
  enterGuestMode:
    "гостевой вход по определению без аккаунта; разрешение берётся из AppSetting, данные гостя живут в localStorage",
  exitGuestMode: "снимает cookie гостевого режима; ни сессии, ни данных не касается",
};

type ActionFn = { name: string; file: string; body: string };

function exportedActions(file: string): ActionFn[] {
  const source = readFileSync(path.join(ACTIONS_DIR, file), "utf8");
  const marker = /^export async function (\w+)/gm;
  const found = [...source.matchAll(marker)].map((match) => ({
    name: match[1],
    start: match.index,
  }));

  return found.map((entry, index) => ({
    name: entry.name,
    file,
    body: source.slice(entry.start, found[index + 1]?.start ?? source.length),
  }));
}

/** Позиция первого обращения к данным, либо Infinity. */
function dataAccessAt(body: string): number {
  return Math.min(
    ...DATA_ACCESS.map((token) => {
      const at = body.indexOf(token);
      return at < 0 ? Number.POSITIVE_INFINITY : at;
    }),
  );
}

const actionFiles = readdirSync(ACTIONS_DIR).filter((name) =>
  name.endsWith(".ts"),
);
const actions = actionFiles.flatMap(exportedActions);
const guarded = actions.filter((action) => !(action.name in WITHOUT_AUTH));

describe("граница авторизации Server Actions", () => {
  it("видит все файлы actions и их экспорты", () => {
    // Пустой набор сделал бы каждую проверку ниже зелёной впустую.
    expect(actionFiles.sort()).toEqual([
      "attachments.ts",
      "guest.ts",
      "index.ts",
      "insights.ts",
      "spaces.ts",
    ]);
    expect(actions.length).toBeGreaterThan(25);
  });

  it("каждое действие вне allowlist проверяет сессию", () => {
    const missing = guarded
      .filter(
        (action) =>
          !action.body.includes(AUTH_CALL) || sessionGuardAt(action.body) < 0,
      )
      .map((action) => `${action.file}:${action.name}`);

    expect(missing).toEqual([]);
  });

  it("проверяет сессию до первого обращения к данным", () => {
    // Именно порядок отличает контроль от его видимости: `auth()` после
    // запроса к БД уже ничего не защищает.
    const late = guarded
      .filter((action) => {
        const authAt = action.body.indexOf(AUTH_CALL);
        const guardAt = sessionGuardAt(action.body);
        const dataAt = dataAccessAt(action.body);
        return !(authAt < guardAt && guardAt < dataAt);
      })
      .map((action) => `${action.file}:${action.name}`);

    expect(late).toEqual([]);
  });

  it("не оставляет в allowlist исчезнувшие или ставшие защищёнными действия", () => {
    const stale = Object.keys(WITHOUT_AUTH).filter((name) => {
      const action = actions.find((entry) => entry.name === name);
      return action === undefined || action.body.includes(AUTH_CALL);
    });

    expect(stale).toEqual([]);
  });

  it("требует непустую причину у каждого исключения", () => {
    for (const [name, reason] of Object.entries(WITHOUT_AUTH)) {
      expect(reason.trim().length, name).toBeGreaterThan(0);
    }
  });

  it("детектор данных не вырождается", () => {
    // Если бы `dataAccessAt` перестал что-либо находить, проверка порядка
    // проходила бы для любого кода — тот же способ отказа, что у A29.
    const withPrisma = "const x = await prisma.list.findMany();";
    expect(dataAccessAt(withPrisma)).toBe(withPrisma.indexOf("prisma."));
    expect(dataAccessAt("await withSpaceDb(spaceId, async (tx) => {})")).toBe(6);
    expect(dataAccessAt("return { success: true };")).toBe(
      Number.POSITIVE_INFINITY,
    );
    // И наоборот: хотя бы одно настоящее действие обязано обращаться к данным,
    // иначе набор разобран неверно.
    expect(
      guarded.some((action) => Number.isFinite(dataAccessAt(action.body))),
    ).toBe(true);
  });

  it("детектор проверки сессии понимает все формы записи, встречающиеся в коде", () => {
    // Первая редакция теста искала точную строку `if (!session?.user?.id)` и
    // потому «нашла» дыру в `createList` и `getListInsight`, где проверка есть,
    // но записана иначе. Ложное срабатывание такого гейта опаснее молчания: оно
    // заставляет подгонять код под тест.
    expect(sessionGuardAt("if (!session?.user?.id) return null;")).toBe(0);
    expect(
      sessionGuardAt("if (!session || !session.user || !session.user.id) {"),
    ).toBe(0);
    expect(sessionGuardAt("if (!session?.user?.id || !spaceId) {")).toBe(0);
    expect(sessionGuardAt("const session = await auth();")).toBe(-1);
  });
});
