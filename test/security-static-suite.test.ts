/**
 * @file security-static-suite.test.ts
 * @description Контракт независимого static security gate.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  staticSecuritySuites,
  staticSecurityTestPaths,
} from "../vitest.security.config";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string> };
const ci = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

describe("static security suite", () => {
  it("содержит только существующие уникальные test-файлы с описанным контролем", () => {
    expect(new Set(staticSecurityTestPaths).size).toBe(
      staticSecurityTestPaths.length,
    );

    for (const suite of staticSecuritySuites) {
      expect(suite.path).toMatch(/\.test\.ts$/);
      expect(suite.controls.length).toBeGreaterThan(0);
      const suitePath = fileURLToPath(
        new URL("../" + suite.path, import.meta.url),
      );
      expect(existsSync(suitePath), suite.path).toBe(true);
    }
  });

  it("не позволяет gate потерять собственный контракт", () => {
    expect(staticSecurityTestPaths).toContain(
      "test/security-static-suite.test.ts",
    );
  });

  it("закрепляет отдельную npm-команду и CI job", () => {
    expect(packageJson.scripts?.["test:security:static"]).toBe(
      "vitest run --config vitest.security.config.ts",
    );
    expect(ci).toContain("  security-static:");
    expect(ci).toContain("run: npm run test:security:static");
    expect(ci).toContain(
      "needs: [security-static, checks, integration, e2e, secrets, gate]",
    );
    expect(ci).toContain("  gate:");
    expect(ci).toContain("if: ${{ always() }}");
  });

  it("оставляет dependency review только на PR и без write-permissions", () => {
    const job = ci.slice(
      ci.indexOf("  dependency-review:"),
      ci.indexOf("  production-migration:"),
    );

    expect(job).toContain("github.event_name == 'pull_request'");
    expect(job).toContain("contents: read");
    expect(job).not.toContain("pull-requests: write");
    expect(job).toContain(
      "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
    );
  });
});
