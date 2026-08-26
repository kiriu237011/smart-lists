import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

const workflow = readRepoFile(".github/workflows/configure-production-rls.yml");
const ciWorkflow = readRepoFile(".github/workflows/ci.yml");
const configurator = readRepoFile(
  "scripts/configure-tenant-enforcement.mjs",
);

describe("Production tenant RLS workflow", () => {
  it("работает только из main и только с жёстко заданным Production Environment", () => {
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("environment: Production");
    expect(workflow).not.toContain("environment: ${{");
    expect(workflow).not.toContain("environment: preview");
    expect(workflow).toContain("permissions:\n  contents: read");
  });

  it("принимает только именованные линейные переходы", () => {
    expect(workflow).toContain("- enable-usage-canary");
    expect(workflow).toContain("- rollback-usage-canary");
    expect(workflow).toContain("- enable-list-item");
    expect(workflow).toContain("- rollback-list-item");
    expect(workflow).toContain("- enable-space-groups");
    expect(workflow).toContain("- rollback-space-groups");
    expect(workflow).toContain("- enable-tenant-full");
    expect(workflow).toContain("- rollback-tenant-full");
    expect(workflow).not.toContain("--group=");
    expect(configurator).not.toContain("--table=");
    expect(configurator).not.toContain("FORCE ROW LEVEL SECURITY");
  });

  it("требует точное подтверждение до установки и доступа к DB secret", () => {
    const confirmationStep = workflow.slice(
      workflow.indexOf("- name: Verify explicit Production confirmation"),
      workflow.indexOf("- name: Install dependencies"),
    );
    expect(workflow).toContain("description: Type APPLY PRODUCTION RLS");
    expect(confirmationStep).toContain(
      'test "${PRODUCTION_CONFIRMATION}" = "APPLY PRODUCTION RLS"',
    );
    expect(confirmationStep).not.toContain("DIRECT_URL");
  });

  it("сериализуется с Production migration и не отменяет начатое изменение", () => {
    expect(workflow).toContain("group: production-database-release");
    expect(ciWorkflow).toContain("group: production-database-release");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it("не выдаёт DB secret установке и проверяет target до apply", () => {
    const installStep = workflow.slice(
      workflow.indexOf("- name: Install dependencies"),
      workflow.indexOf("- name: Verify Production database target"),
    );
    expect(installStep).toContain("npm ci --ignore-scripts");
    expect(installStep).not.toContain("DIRECT_URL");
    expect(workflow.indexOf("node scripts/verify-release-database.mjs"))
      .toBeLessThan(
        workflow.indexOf("npm run db:configure-tenant-enforcement"),
      );
    expect(workflow).toContain("--apply");
    expect(workflow).toContain(
      "EXPECTED_DATABASE_HOST: ${{ secrets.EXPECTED_DATABASE_HOST }}",
    );
  });
});
