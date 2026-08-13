/**
 * @file vercel-build-cutover.test.ts
 * @description Контракт отделения Vercel build от миграционного credential.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readRepoFile = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

const packageJson = JSON.parse(readRepoFile("package.json")) as {
  scripts: Record<string, string>;
};
const vercel = JSON.parse(readRepoFile("vercel.json")) as {
  buildCommand: string;
};
const prismaConfig = readRepoFile("prisma.config.ts");

describe("Vercel build cutover", () => {
  it("собирает приложение без запуска миграций", () => {
    expect(vercel.buildCommand).toBe("npm run build");
    expect(packageJson.scripts["build:deploy"]).toBeUndefined();
    expect(packageJson.scripts["migrate:deploy"]).toBe(
      "prisma migrate deploy",
    );
  });

  it("позволяет prisma generate загрузить config без DIRECT_URL", () => {
    expect(prismaConfig).toContain('url: process.env.DIRECT_URL ?? ""');
    expect(prismaConfig).not.toContain('env("DIRECT_URL")');
  });
});
