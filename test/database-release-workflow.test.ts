import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

const ci = readRepoFile(".github/workflows/ci.yml");
const guard = readRepoFile("scripts/verify-release-database.mjs");
const productionJob = ci.slice(ci.indexOf("  production-migration:"));

describe("database release workflow", () => {
  it("вызывается только после всех проверок push в main", () => {
    expect(ci).toContain("github.event_name == 'push'");
    expect(ci).toContain("github.ref == 'refs/heads/main'");
    expect(ci).toContain(
      "vars.ENABLE_PRODUCTION_MIGRATION == 'true'",
    );
    expect(ci).toContain("needs: [checks, integration, e2e, secrets]");
    expect(productionJob).not.toContain("uses: ./.github/workflows/");
  });

  it("не отменяет уже начатую main-миграцию", () => {
    expect(ci).toContain(
      "vars.ENABLE_PRODUCTION_MIGRATION != 'true'",
    );
    expect(productionJob).toContain("group: production-database-release");
    expect(productionJob).toContain("cancel-in-progress: false");
  });

  it("держит environment и secrets в самой CI job без reusable-границы", () => {
    const reusablePath = fileURLToPath(
      new URL("../.github/workflows/database-release.yml", import.meta.url),
    );

    expect(existsSync(reusablePath)).toBe(false);
    expect(productionJob).toContain("environment: Production");
    expect(productionJob).toContain("DIRECT_URL: ${{ secrets.DIRECT_URL }}");
    expect(productionJob).toContain(
      "EXPECTED_DATABASE_HOST: ${{ secrets.EXPECTED_DATABASE_HOST }}",
    );
    expect(productionJob).toContain("node scripts/verify-release-database.mjs");
    expect(productionJob).toContain("run: npm run migrate:deploy");
  });

  it("не выдаёт настоящий DB secret npm lifecycle scripts", () => {
    const installStep = productionJob.slice(
      productionJob.indexOf("- name: Install dependencies"),
      productionJob.indexOf("- name: Verify database target"),
    );

    expect(installStep).not.toContain("DIRECT_URL");
    expect(guard).not.toContain("target.host");
    expect(guard).not.toContain("target.database");
  });
});
