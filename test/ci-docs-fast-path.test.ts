/**
 * @file ci-docs-fast-path.test.ts
 * @description Fail-closed контракт ускоренного пути документации.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DOCS_FAST_PATHS,
  classifyChanges,
  verifyGate,
} from "../scripts/ci-policy.mjs";

const ci = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

const markdown = Buffer.from("# Документ\n\nОбычный UTF-8 текст.\n", "utf8");

const change = (
  path = "README.md",
  overrides: Record<string, unknown> = {},
) => ({
  status: "M",
  path,
  baseMode: "100644",
  headMode: "100644",
  content: markdown,
  ...overrides,
});

const classify = (changes: unknown[], overrides: Record<string, unknown> = {}) =>
  classifyChanges({
    eventName: "pull_request",
    fastPathEnabled: "true",
    changes,
    ...overrides,
  });

describe("docs-only classifier", () => {
  it("разрешает только точный закрытый список существующих документов", () => {
    expect(DOCS_FAST_PATHS).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "DATABASE_SECURITY.md",
      "PROJECT_MEMORY.md",
      "README.md",
      "THREAT_MODEL.md",
    ]);
    expect(classify(DOCS_FAST_PATHS.map((path) => change(path))).mode).toBe(
      "docs",
    );
  });

  it.each([
    ["смешанный diff", [change(), change("src/app/page.tsx")]],
    ["новый Markdown", [change("docs/new.md", { status: "A" })]],
    ["удаление", [change("README.md", { status: "D" })]],
    ["переименование", [change("README.md", { status: "R100" })]],
    ["исполняемый mode", [change("README.md", { headMode: "100755" })]],
    ["symlink", [change("README.md", { headMode: "120000" })]],
    ["NUL-байт", [change("README.md", { content: Buffer.from([0]) })]],
    ["не UTF-8", [change("README.md", { content: Buffer.from([0xff]) })]],
    ["CRLF", [change("README.md", { content: Buffer.from("x\r\n") })]],
    ["пустой diff", []],
  ])("отправляет %s в полный CI", (_name, changes) => {
    expect(classify(changes).mode).toBe("full");
  });

  it("не включается без явной repository variable и вне PR", () => {
    expect(
      classify([change()], { fastPathEnabled: "false" }).mode,
    ).toBe("full");
    expect(classify([change()], { eventName: "push" }).mode).toBe("full");
  });
});

const fullResults = {
  classify: "success",
  docs: "skipped",
  securityStatic: "success",
  checks: "success",
  integration: "success",
  e2e: "success",
  secrets: "success",
  dependencyReview: "success",
};

describe("aggregate CI gate", () => {
  it("принимает полный PR только с реально успешными тяжёлыми job", () => {
    expect(() =>
      verifyGate({
        mode: "full",
        eventName: "pull_request",
        results: fullResults,
      }),
    ).not.toThrow();

    expect(() =>
      verifyGate({
        mode: "full",
        eventName: "pull_request",
        results: { ...fullResults, e2e: "skipped" },
      }),
    ).toThrow(/e2e/);
  });

  it("принимает docs PR только с быстрыми security-проверками", () => {
    expect(() =>
      verifyGate({
        mode: "docs",
        eventName: "pull_request",
        results: {
          ...fullResults,
          docs: "success",
          securityStatic: "skipped",
          checks: "skipped",
          integration: "skipped",
          e2e: "skipped",
        },
      }),
    ).not.toThrow();
  });

  it("учитывает отсутствие dependency review только вне PR", () => {
    expect(() =>
      verifyGate({
        mode: "full",
        eventName: "push",
        results: { ...fullResults, dependencyReview: "skipped" },
      }),
    ).not.toThrow();
  });
});

describe("docs fast path workflow", () => {
  it("проверяет feature-ветки по полному PR, а main — после merge", () => {
    expect(ci).toContain("branches: [main]");
    expect(ci).toContain("  pull_request:");
    expect(ci).not.toContain("branches-ignore: ['dependabot/**']");
    expect(ci).not.toMatch(/paths-ignore:/);
  });

  it("остаётся opt-in до настройки required gate", () => {
    expect(ci).toContain("vars.ENABLE_DOCS_ONLY_CI");
    expect(ci).toContain("run: node scripts/ci-policy.mjs classify");
  });

  it("запускает gate всегда и проверяет результаты всех веток", () => {
    const gate = ci.slice(
      ci.indexOf("  gate:"),
      ci.indexOf("  production-migration:"),
    );
    expect(gate).toContain("if: ${{ always() }}");
    for (const job of [
      "classify",
      "docs",
      "security-static",
      "checks",
      "integration",
      "e2e",
      "secrets",
      "dependency-review",
    ]) {
      expect(gate).toContain(`      - ${job}`);
    }
    expect(gate).toContain("run: node scripts/ci-policy.mjs gate");
  });
});
