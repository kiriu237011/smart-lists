/**
 * @file outbound-requests.test.ts
 * @description Полнота контроля исходящих запросов приложения (A68).
 *
 * Зачем. Egress рантайма Vercel не ограничен ничем и ограничить его нечем:
 * фильтрации по адресатам у Vercel нет ни на одном тарифе. Барьер поэтому
 * держится целиком кодом — «адрес каждого серверного запроса задан кодом, а не
 * данными пользователя». До 2026-09-01 это утверждение закреплял только разбор
 * самого адреса (`insights-service-url.test.ts`), но не его единственность:
 * новый `fetch` в Server Action — в том числе по адресу из пользовательских
 * данных — не покрасил бы ни один прогон.
 *
 * Форма проверки та же, что у `mutation-budget-coverage.test.ts` и
 * `dependency-install-hooks.test.ts`: набор берётся обходом `src`, а не
 * списком, который надо не забыть пополнить. Новый исходящий вызов обязан
 * появиться в allowlist вместе с причиной — то есть стать осознанным решением.
 *
 * Серверные и клиентские вызовы разделены по директиве `use client`, потому что
 * это разные угрозы: серверный уходит из рантайма Vercel с его доступом к БД и
 * секретам, клиентский — из браузера пользователя.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SRC = path.resolve(process.cwd(), "src");

/**
 * Способы уйти наружу. Список закрывает не «все мыслимые», а все достижимые
 * здесь: прямых http-клиентов в зависимостях нет (проверено в package.json),
 * поэтому остаются платформенные API и импорт нового клиента.
 */
const OUTBOUND = [
  { name: "fetch", pattern: /\bfetch\s*\(/ },
  { name: "WebSocket", pattern: /\bnew\s+WebSocket\s*\(/ },
  { name: "EventSource", pattern: /\bnew\s+EventSource\s*\(/ },
  { name: "XMLHttpRequest", pattern: /\bnew\s+XMLHttpRequest\b/ },
  { name: "sendBeacon", pattern: /\bsendBeacon\s*\(/ },
  {
    name: "http-client-import",
    pattern: /\bfrom\s+["'](?:axios|got|node-fetch|undici|ky|superagent)["']/,
  },
  { name: "node-http", pattern: /\bfrom\s+["']node:https?["']/ },
] as const;

/**
 * Серверные файлы, которым исходящий запрос разрешён, и почему.
 * Пустая причина недопустима: смысл allowlist в объяснении, а не в разрешении.
 */
const SERVER_ALLOWED: Readonly<Record<string, string>> = {
  "src/app/actions/insights.ts":
    "единственный серверный egress; адрес проходит resolveInsightsServiceUrl и задаёт audience токена (A68)",
};

/** Клиентские файлы: запрос уходит из браузера пользователя, не из рантайма. */
const CLIENT_ALLOWED: Readonly<Record<string, string>> = {
  "src/components/lists/Attachments.tsx":
    "загрузка файла по presigned POST прямо в S3, минуя рантайм",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Сгенерированный Prisma-клиент не наш код и не редактируется руками.
      return entry.name === "generated" ? [] : sourceFiles(absolute);
    }
    if (/\.(?:test|spec)\.tsx?$/.test(entry.name)) return [];
    return /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

/** Какие способы уйти наружу встречаются в тексте. */
function outboundIn(source: string): string[] {
  return OUTBOUND.filter(({ pattern }) => pattern.test(source)).map(
    ({ name }) => name,
  );
}

/** Клиентский модуль — тот, что объявил `use client` директивой в начале. */
function isClientModule(source: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(source);
}

const files = sourceFiles(SRC).map((file) => {
  const source = readFileSync(file, "utf8");
  return {
    path: relative(file),
    client: isClientModule(source),
    outbound: outboundIn(source),
    source,
  };
});

describe("исходящие запросы приложения", () => {
  it("видит исходники и различает клиентские модули", () => {
    // Пустой или неразобранный набор сделал бы всё остальное зелёным впустую.
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(({ client }) => client)).toBe(true);
    expect(files.some(({ client }) => !client)).toBe(true);
  });

  it("детектор срабатывает на реальных способах уйти наружу", () => {
    expect(outboundIn('await fetch("https://example.test")')).toEqual(["fetch"]);
    expect(outboundIn('new WebSocket("wss://example.test")')).toEqual([
      "WebSocket",
    ]);
    expect(outboundIn('import axios from "axios";')).toEqual([
      "http-client-import",
    ]);
    expect(outboundIn('import { request } from "node:https";')).toEqual([
      "node-http",
    ]);
  });

  it("детектор не срабатывает на похожих именах", () => {
    // `AuditEventSource` из Prisma-клиента ловится наивным /EventSource/, и
    // такой промах сделал бы allowlist бессмысленно длинным.
    expect(outboundIn("type EnumAuditEventSourceFilter = { equals: string }")).toEqual([]);
    expect(outboundIn("const prefetched = prefetch(list);")).toEqual([]);
    expect(outboundIn('import { after } from "next/server";')).toEqual([]);
  });

  it("не допускает серверного исходящего запроса вне allowlist", () => {
    const unexplained = files
      .filter(({ client, outbound }) => !client && outbound.length > 0)
      .filter(({ path: file }) => !(file in SERVER_ALLOWED))
      .map(({ path: file, outbound }) => `${file}: ${outbound.join(", ")}`);

    expect(unexplained).toEqual([]);
  });

  it("не допускает клиентского исходящего запроса вне allowlist", () => {
    const unexplained = files
      .filter(({ client, outbound }) => client && outbound.length > 0)
      .filter(({ path: file }) => !(file in CLIENT_ALLOWED))
      .map(({ path: file, outbound }) => `${file}: ${outbound.join(", ")}`);

    expect(unexplained).toEqual([]);
  });

  it("не оставляет в allowlist файлы, переставшие ходить наружу", () => {
    const byPath = new Map(files.map((entry) => [entry.path, entry]));
    const stale = [
      ...Object.keys(SERVER_ALLOWED),
      ...Object.keys(CLIENT_ALLOWED),
    ].filter((file) => (byPath.get(file)?.outbound.length ?? 0) === 0);

    expect(stale).toEqual([]);
  });

  it("требует непустую причину у каждого исключения", () => {
    for (const [file, reason] of Object.entries({
      ...SERVER_ALLOWED,
      ...CLIENT_ALLOWED,
    })) {
      expect(reason.trim().length, file).toBeGreaterThan(0);
    }
  });

  it("держит адрес единственного серверного запроса на проверенном резолвере", () => {
    // Связка и есть то, что ограничивает ущерб: тот же адрес задаёт audience
    // ID-токена, поэтому увести запрос на чужой хост нельзя, не получив токен,
    // выписанный на этот же хост. Поведение закреплено интеграционно; здесь —
    // что резолвер вообще остался на пути запроса.
    const insights = files.find(
      ({ path: file }) => file === "src/app/actions/insights.ts",
    );

    expect(insights).toBeDefined();
    expect(insights?.source).toContain("resolveInsightsServiceUrl");
  });
});
