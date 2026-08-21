import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  identifyEnforcementProfile,
  parseEnforcementArguments,
  resolveEnforcementTransition,
} from "../scripts/configure-tenant-enforcement.mjs";

describe("tenant enforcement contract", () => {
  it("реально запускает CLI из пути с пробелами", () => {
    const scriptPath = fileURLToPath(
      new URL("../scripts/configure-tenant-enforcement.mjs", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [scriptPath, "--operation=unknown"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Неизвестная enforcement operation");
  });

  it("принимает только две именованные операции и явный apply", () => {
    expect(
      parseEnforcementArguments([
        "--apply",
        "--operation=enable-usage-canary",
      ]),
    ).toEqual({ apply: true, operation: "enable-usage-canary" });
    expect(
      parseEnforcementArguments(["--operation=rollback-usage-canary"]),
    ).toEqual({ apply: false, operation: "rollback-usage-canary" });

    expect(() => parseEnforcementArguments([])).toThrow("ровно один");
    expect(() =>
      parseEnforcementArguments(["--operation=enable-all"]),
    ).toThrow("Неизвестная enforcement operation");
    expect(() =>
      parseEnforcementArguments([
        "--operation=enable-usage-canary",
        "--environment=Production",
      ]),
    ).toThrow("Неизвестные аргументы");
  });

  it("распознаёт только disabled и однотабличный usage-canary", () => {
    expect(identifyEnforcementProfile([], [])).toBe("disabled");
    expect(
      identifyEnforcementProfile(["UserDailyUsage"], ["UserDailyUsage"]),
    ).toBe("usage-canary");

    expect(() => identifyEnforcementProfile(["Space"], ["Space"])).toThrow(
      "не соответствует известному rollout-профилю",
    );
    expect(() =>
      identifyEnforcementProfile(["UserDailyUsage"], []),
    ).toThrow("не соответствует известному rollout-профилю");
  });

  it("делает enable и rollback идемпотентными, не расширяя группу", () => {
    expect(resolveEnforcementTransition("enable-usage-canary", "disabled"))
      .toEqual({
        targetProfile: "usage-canary",
        changed: true,
        tables: ["UserDailyUsage"],
      });
    expect(
      resolveEnforcementTransition("enable-usage-canary", "usage-canary"),
    ).toMatchObject({ targetProfile: "usage-canary", changed: false });
    expect(
      resolveEnforcementTransition("rollback-usage-canary", "usage-canary"),
    ).toEqual({ targetProfile: "disabled", changed: true, tables: [] });
    expect(resolveEnforcementTransition("rollback-usage-canary", "disabled"))
      .toMatchObject({ targetProfile: "disabled", changed: false });
  });
});
