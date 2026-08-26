import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AUDIT_RETENTION_CONFIRMATION,
  AUDIT_RETENTION_DAYS,
  assertAuditRetentionRequest,
} from "../scripts/prune-audit-events.mjs";

const workflowPath = fileURLToPath(
  new URL("../.github/workflows/audit-retention.yml", import.meta.url),
);

const validRequest = {
  apply: true,
  confirmation: AUDIT_RETENTION_CONFIRMATION,
  directUrl: "postgresql://migrator:secret@db.example.test/smartlists",
  expectedHost: "db.example.test",
  expectedRole: "smartlists_migrator",
};

describe("audit trail retention", () => {
  it("фиксирует срок хранения и точное подтверждение", () => {
    expect(AUDIT_RETENTION_DAYS).toBe(180);
    expect(() => assertAuditRetentionRequest(validRequest)).not.toThrow();
    expect(() =>
      assertAuditRetentionRequest({ ...validRequest, apply: false }),
    ).toThrow();
    expect(() =>
      assertAuditRetentionRequest({ ...validRequest, confirmation: "delete" }),
    ).toThrow();
  });

  it("отклоняет неверную или pooled DB-цель", () => {
    expect(() =>
      assertAuditRetentionRequest({
        ...validRequest,
        expectedHost: "other.example.test",
      }),
    ).toThrow();
    expect(() =>
      assertAuditRetentionRequest({
        ...validRequest,
        directUrl:
          "postgresql://migrator:secret@db-pooler.example.test/smartlists",
        expectedHost: "db-pooler.example.test",
      }),
    ).toThrow();
  });

  it("workflow разделяет среды, locks и требует opt-in для расписания", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("environment: preview");
    expect(workflow).toContain("environment: Production");
    expect(workflow).toContain("group: preview-database-change");
    expect(workflow).toContain("group: production-database-release");
    expect(workflow).toContain("ENABLE_PREVIEW_AUDIT_RETENTION == 'true'");
    expect(workflow).toContain("ENABLE_PRODUCTION_AUDIT_RETENTION == 'true'");
    expect(workflow.match(/npm ci --ignore-scripts/g)).toHaveLength(2);
    expect(workflow.match(/db:prune-audit-events -- --apply/g)).toHaveLength(2);
  });
});
