/**
 * @file next-config.test.ts
 * @description Проверка настроек, уменьшающих раскрытие деталей платформы.
 */

import { describe, expect, it } from "vitest";

import { nextConfig } from "../next.config";

describe("nextConfig", () => {
  it("не публикует X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
