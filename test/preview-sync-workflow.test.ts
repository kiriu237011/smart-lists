/**
 * @file preview-sync-workflow.test.ts
 * @description Статический контракт автоматической синхронизации OAuth proxy.
 *
 * Workflow имеет право записи в репозиторий, поэтому опасные регрессии здесь —
 * не косметика: запуск после PR или merge непроверенного HEAD превратил бы
 * обычный CI в путь записи и деплоя недоверенного кода.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
  new URL("../.github/workflows/sync-preview.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");

describe("sync-preview workflow", () => {
  it("запускается после CI main и отбрасывает PR и неуспешные прогоны", () => {
    expect(workflow).toContain("workflows: ['CI']");
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(workflow).toContain(
      "github.event.workflow_run.head_branch == 'main'",
    );
  });

  it("мержит проверенный SHA, а не более свежий непроверенный main", () => {
    expect(workflow).toContain(
      "TARGET_SHA: ${{ github.event.workflow_run.head_sha }}",
    );
    expect(workflow).toContain('git merge --no-edit "${TARGET_SHA}"');
    expect(workflow).not.toContain("git merge --no-edit origin/main");
  });

  it("пишет только в preview и включает миграцию лишь явным feature flag", () => {
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("git push origin HEAD:preview");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain(
      "vars.ENABLE_PREVIEW_MIGRATION == 'true'",
    );
    expect(workflow).toContain("DIRECT_URL: ${{ secrets.DIRECT_URL }}");
    expect(workflow.indexOf("run: npm run migrate:deploy")).toBeLessThan(
      workflow.indexOf("run: git push origin HEAD:preview"),
    );
  });

  it.each([
    "src/auth.ts",
    "src/app/api/auth",
    "src/lib/allowed-email.ts",
    "src/proxy.ts",
    "prisma/schema.prisma",
    "package-lock.json",
    "next.config.ts",
    "vercel.json",
    "scripts/verify-release-database.mjs",
  ])("следит за runtime-зависимостью %s", (path) => {
    expect(workflow).toContain(path);
  });
});
