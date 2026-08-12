import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

const ci = readRepoFile(".github/workflows/ci.yml");
const release = readRepoFile(".github/workflows/database-release.yml");

describe("database release workflow", () => {
  it("вызывается только после всех проверок push в main", () => {
    expect(ci).toContain("github.event_name == 'push'");
    expect(ci).toContain("github.ref == 'refs/heads/main'");
    expect(ci).toContain(
      "vars.ENABLE_PRODUCTION_MIGRATION == 'true'",
    );
    expect(ci).toContain("needs: [checks, integration, e2e, secrets]");
    expect(ci).toContain("uses: ./.github/workflows/database-release.yml");
    expect(release).toContain("workflow_call:");
    expect(release).not.toMatch(/^\s+push:/m);
    expect(release).not.toMatch(/^\s+pull_request:/m);
  });

  it("не отменяет уже начатую main-миграцию", () => {
    expect(ci).toContain(
      "vars.ENABLE_PRODUCTION_MIGRATION != 'true'",
    );
    expect(release).toContain("group: production-database-release");
    expect(release).toContain("cancel-in-progress: false");
  });

  it("берёт credential из production environment и fail-closed сверяет host", () => {
    expect(release).toContain("environment: production");
    expect(release).toContain("DIRECT_URL: ${{ secrets.DIRECT_URL }}");
    expect(release).toContain(
      "EXPECTED_DATABASE_HOST: ${{ vars.EXPECTED_DATABASE_HOST }}",
    );
    expect(release).toContain("node scripts/verify-release-database.mjs");
    expect(release).toContain("run: npm run migrate:deploy");
  });

  it("не выдаёт настоящий DB secret npm lifecycle scripts", () => {
    expect(release).toContain(
      "DIRECT_URL: postgresql://release:release@127.0.0.1:5432/placeholder",
    );
  });
});
