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

  it("принимает только четыре именованные операции и явный apply", () => {
    expect(
      parseEnforcementArguments([
        "--apply",
        "--operation=enable-usage-canary",
      ]),
    ).toEqual({ apply: true, operation: "enable-usage-canary" });
    expect(
      parseEnforcementArguments(["--operation=rollback-usage-canary"]),
    ).toEqual({ apply: false, operation: "rollback-usage-canary" });
    expect(
      parseEnforcementArguments(["--operation=enable-list-item"]),
    ).toEqual({ apply: false, operation: "enable-list-item" });
    expect(
      parseEnforcementArguments(["--operation=rollback-list-item"]),
    ).toEqual({ apply: false, operation: "rollback-list-item" });

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

  it("распознаёт только три последовательных rollout-профиля", () => {
    expect(identifyEnforcementProfile([], [])).toBe("disabled");
    expect(
      identifyEnforcementProfile(["UserDailyUsage"], ["UserDailyUsage"]),
    ).toBe("usage-canary");
    expect(
      identifyEnforcementProfile(
        ["Item", "List", "UserDailyUsage"],
        ["UserDailyUsage", "List", "Item"],
      ),
    ).toBe("list-item");

    expect(() => identifyEnforcementProfile(["Space"], ["Space"])).toThrow(
      "не соответствует известному rollout-профилю",
    );
    expect(() =>
      identifyEnforcementProfile(["UserDailyUsage"], []),
    ).toThrow("не соответствует известному rollout-профилю");
    expect(() =>
      identifyEnforcementProfile(
        ["UserDailyUsage", "List", "Item"],
        ["UserDailyUsage", "List"],
      ),
    ).toThrow("не соответствует известному rollout-профилю");
  });

  it("делает линейные enable/rollback идемпотентными, не перепрыгивая профили", () => {
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

    expect(resolveEnforcementTransition("enable-list-item", "usage-canary"))
      .toEqual({
        targetProfile: "list-item",
        changed: true,
        tables: ["UserDailyUsage", "List", "Item"],
      });
    expect(resolveEnforcementTransition("enable-list-item", "list-item"))
      .toMatchObject({ targetProfile: "list-item", changed: false });
    expect(resolveEnforcementTransition("rollback-list-item", "list-item"))
      .toEqual({
        targetProfile: "usage-canary",
        changed: true,
        tables: ["UserDailyUsage"],
      });
    expect(resolveEnforcementTransition("rollback-list-item", "usage-canary"))
      .toMatchObject({ targetProfile: "usage-canary", changed: false });

    expect(() =>
      resolveEnforcementTransition("enable-list-item", "disabled"),
    ).toThrow("запрещена из профиля disabled");
    expect(() =>
      resolveEnforcementTransition("rollback-usage-canary", "list-item"),
    ).toThrow("запрещена из профиля list-item");
  });
});
