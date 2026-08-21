/**
 * @file database-audit-workflow.test.ts
 * @description Статический security-контракт ручного catalog audit.
 *
 * Workflow получает direct migrator credential выбранного Environment. Поэтому
 * его безопасность зависит не от того, что текущий audit read-only, а от
 * сохранения всех границ одновременно: только main, минимальные permissions,
 * отсутствие секрета на install-шаге и target guard до соединения.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  fileURLToPath(
    new URL("../.github/workflows/audit-database.yml", import.meta.url),
  ),
  "utf8",
);
const auditScript = readFileSync(
  fileURLToPath(
    new URL("../scripts/audit-database-privileges.mjs", import.meta.url),
  ),
  "utf8",
);

describe("database catalog audit workflow", () => {
  it("запускает job только с main и выбранным известным Environment", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("- preview");
    expect(workflow).toContain("- Production");
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(workflow).toContain("environment: ${{ inputs.environment }}");
  });

  it("не получает write-permissions и не отменяет начатый audit", () => {
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).not.toContain("contents: write");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it("не выдаёт DB secret установке зависимостей", () => {
    const installStep = workflow.slice(
      workflow.indexOf("- name: Install dependencies"),
      workflow.indexOf("- name: Verify database target"),
    );

    expect(installStep).toContain("npm ci --ignore-scripts");
    expect(installStep).not.toContain("DIRECT_URL");
    expect(installStep).not.toContain("AUDIT_DATABASE_URL");
  });

  it("проверяет exact target до read-only audit runtime-роли", () => {
    expect(workflow.indexOf("node scripts/verify-release-database.mjs"))
      .toBeLessThan(workflow.indexOf("npm run db:audit-privileges"));
    expect(workflow).toContain(
      "EXPECTED_DATABASE_HOST: ${{ secrets.EXPECTED_DATABASE_HOST }}",
    );
    expect(workflow).toContain(
      "AUDIT_DATABASE_URL: ${{ secrets.DIRECT_URL }}",
    );
    expect(workflow).toContain("AUDIT_ROLE: smartlists_runtime");
    expect(auditScript).toContain('await client.query("BEGIN READ ONLY")');
  });
});
