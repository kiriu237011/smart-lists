import { describe, expect, it } from "vitest";

import { verifyReleaseDatabaseTarget } from "../scripts/verify-release-database.mjs";

describe("verifyReleaseDatabaseTarget", () => {
  it("принимает точный direct host и не возвращает credentials", () => {
    expect(
      verifyReleaseDatabaseTarget(
        "postgresql://owner:secret@ep-prod.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
        "ep-prod.ap-southeast-1.aws.neon.tech",
      ),
    ).toEqual({
      host: "ep-prod.ap-southeast-1.aws.neon.tech",
      database: "neondb",
    });
  });

  it("отклоняет URL другой среды", () => {
    expect(() =>
      verifyReleaseDatabaseTarget(
        "postgresql://owner:secret@ep-preview.ap-southeast-1.aws.neon.tech/neondb",
        "ep-prod.ap-southeast-1.aws.neon.tech",
      ),
    ).toThrow("Release DB host не совпадает");
  });

  it("отклоняет pooled endpoint", () => {
    expect(() =>
      verifyReleaseDatabaseTarget(
        "postgresql://owner:secret@ep-prod-pooler.ap-southeast-1.aws.neon.tech/neondb",
        "ep-prod-pooler.ap-southeast-1.aws.neon.tech",
      ),
    ).toThrow("pooled endpoint");
  });

  it.each([
    ["", "ep-prod.neon.tech"],
    ["not-a-url", "ep-prod.neon.tech"],
    ["https://ep-prod.neon.tech/neondb", "ep-prod.neon.tech"],
    ["postgresql://owner:secret@ep-prod.neon.tech", "ep-prod.neon.tech"],
    ["postgresql://owner:secret@ep-prod.neon.tech/neondb", ""],
  ])("fail-closed для некорректной конфигурации %#", (url, host) => {
    expect(() => verifyReleaseDatabaseTarget(url, host)).toThrow();
  });
});
