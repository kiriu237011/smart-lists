/**
 * @file prototype-pollution-guard.test.ts
 * @description Отсутствие примитивов prototype pollution в коде приложения.
 *
 * Prototype pollution — дефект прототипной модели JS: недоверенный ключ
 * `__proto__` или `constructor.prototype`, попав в присваивание или в глубокое
 * слияние объектов, меняет прототип, который видит **весь** процесс. Дальше это
 * превращается в обход проверок («у объекта вдруг есть поле, которого не
 * присылали»), а в паре с чувствительным к полям кодом — и в исполнение.
 *
 * На 2026-09-01 ни одного из перечисленных ниже примитивов в `src` нет — аудит
 * это подтвердил, а `Object.hasOwn` в `attachments.ts` закрывает родственный
 * prototype-squatting при поиске по таблице. Но это состояние, а не инвариант:
 * ничто не мешало завтра написать `Object.assign(defaults, input)` в Server
 * Action и получить зелёный прогон. Тест переводит «сегодня чисто» в «нельзя
 * сделать грязно молча», как это уже сделано для бюджета, egress и auth.
 *
 * Чего этот гейт **не** делает: он не ищет рекурсивное слияние собственной
 * реализации и не заменяет taint-анализ CodeQL. Он закрывает конкретные,
 * распознаваемые текстом примитивы; появление своей `deepMerge` остаётся
 * вопросом ревью.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(process.cwd(), "src");

/**
 * Примитивы, каждый со своей механикой.
 *
 * `Object.assign` опасен не сам по себе, а тем, что копирует **через setter**:
 * `Object.assign(target, JSON.parse(input))` с ключом `__proto__` меняет
 * прототип цели, тогда как spread (`{...input}`) создаёт обычное свойство.
 *
 * `Object.fromEntries(formData)` строит объект из ключей, которые задаёт
 * клиент: ключ `__proto__` становится собственным свойством и обманывает
 * последующий код, который такое поле не ждёт. Поэтому Server Actions читают
 * `formData.get(...)` поимённо.
 */
const PRIMITIVES = [
  { name: "__proto__", pattern: /__proto__/ },
  { name: "setPrototypeOf", pattern: /\bsetPrototypeOf\s*\(/ },
  { name: "prototype-assign", pattern: /\.prototype\s*\[/ },
  { name: "Object.assign", pattern: /\bObject\.assign\s*\(/ },
  { name: "fromEntries", pattern: /\bObject\.fromEntries\s*\(/ },
] as const;

/**
 * Нестрогие конструкции Zod. Строгий `z.object` собирает результат из
 * известных ключей, поэтому `__proto__` из тела запроса в него не попадает;
 * `passthrough`/`catchall`/`record` пропускают ключи клиента дальше как есть.
 */
const LOOSE_SCHEMA = [
  { name: "passthrough", pattern: /\.passthrough\s*\(/ },
  { name: "catchall", pattern: /\.catchall\s*\(/ },
  { name: "loose", pattern: /\bz\.looseObject\s*\(|\.loose\s*\(/ },
  { name: "record", pattern: /\bz\.record\s*\(/ },
  { name: "any", pattern: /\bz\.any\s*\(/ },
  { name: "unknown", pattern: /\bz\.unknown\s*\(/ },
] as const;

/**
 * Исключения: файл → причина. Сейчас пуст, и это главное свойство гейта —
 * появление первой строки здесь обязано быть осознанным решением с
 * объяснением, а не побочным следствием правки.
 */
const ALLOWED: Readonly<Record<string, string>> = {};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Сгенерированный Prisma-клиент не наш код и руками не правится.
      return entry.name === "generated" ? [] : sourceFiles(absolute);
    }
    if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) return [];
    return /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function matches(
  source: string,
  rules: ReadonlyArray<{ name: string; pattern: RegExp }>,
): string[] {
  return rules.filter(({ pattern }) => pattern.test(source)).map(({ name }) => name);
}

const files = sourceFiles(SRC).map((file) => ({
  path: relative(file),
  source: readFileSync(file, "utf8"),
}));

describe("примитивы prototype pollution", () => {
  it("видит исходники и разбирает их", () => {
    // Пустой набор сделал бы каждую проверку ниже зелёной впустую.
    expect(files.length).toBeGreaterThan(50);
    // И отдельно — что в наборе есть Zod-схемы: иначе проверка строгости схем
    // ничего не значила бы, оставаясь при этом зелёной. Считаются вхождения, а
    // не файлы: схемы намеренно собраны в нескольких модулях (`validations.ts`,
    // гостевое хранилище, attachments), и счёт файлов давал бы всего три.
    const schemas = files.reduce(
      (total, { source }) => total + (source.match(/\bz\.object\s*\(/g)?.length ?? 0),
      0,
    );
    expect(schemas).toBeGreaterThan(10);
  });

  it("не допускает примитивов вне allowlist", () => {
    const found = files
      .map(({ path: file, source }) => ({ file, hits: matches(source, PRIMITIVES) }))
      .filter(({ file, hits }) => hits.length > 0 && !(file in ALLOWED))
      .map(({ file, hits }) => `${file}: ${hits.join(", ")}`);

    expect(found).toEqual([]);
  });

  it("не допускает нестрогих схем вне allowlist", () => {
    const found = files
      .map(({ path: file, source }) => ({ file, hits: matches(source, LOOSE_SCHEMA) }))
      .filter(({ file, hits }) => hits.length > 0 && !(file in ALLOWED))
      .map(({ file, hits }) => `${file}: ${hits.join(", ")}`);

    expect(found).toEqual([]);
  });

  it("требует непустую причину у каждого исключения", () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason.trim().length, file).toBeGreaterThan(0);
    }
  });

  it("не оставляет в allowlist файлы без нарушений", () => {
    const byPath = new Map(files.map((entry) => [entry.path, entry.source]));
    const stale = Object.keys(ALLOWED).filter((file) => {
      const source = byPath.get(file);
      return (
        source === undefined ||
        matches(source, [...PRIMITIVES, ...LOOSE_SCHEMA]).length === 0
      );
    });

    expect(stale).toEqual([]);
  });

  it("детектор срабатывает на реальных примитивах", () => {
    expect(matches('obj["__proto__"].polluted = 1', PRIMITIVES)).toEqual([
      "__proto__",
    ]);
    expect(matches("Object.setPrototypeOf(target, source)", PRIMITIVES)).toEqual([
      "setPrototypeOf",
    ]);
    expect(matches("Object.assign(defaults, JSON.parse(raw))", PRIMITIVES)).toEqual([
      "Object.assign",
    ]);
    expect(matches("const data = Object.fromEntries(formData);", PRIMITIVES)).toEqual([
      "fromEntries",
    ]);
    expect(matches("const s = z.object({ a: z.string() }).passthrough();", LOOSE_SCHEMA))
      .toEqual(["passthrough"]);
    expect(matches("const s = z.record(z.string(), z.unknown());", LOOSE_SCHEMA))
      .toEqual(["record", "unknown"]);
  });

  it("детектор не срабатывает на безобидном коде", () => {
    // Строгая схема, spread и поимённое чтение FormData — то, как написано
    // приложение сейчас; гейт не должен мешать этому стилю.
    expect(matches("const merged = { ...defaults, ...parsed.data };", PRIMITIVES)).toEqual([]);
    expect(matches('const title = formData.get("title");', PRIMITIVES)).toEqual([]);
    expect(matches("const s = z.object({ title: z.string().min(1) });", LOOSE_SCHEMA)).toEqual([]);
    // `prototype` в тексте комментария или имени не является присваиванием.
    expect(matches("// прототипная цепочка тут ни при чём", PRIMITIVES)).toEqual([]);
  });
});
