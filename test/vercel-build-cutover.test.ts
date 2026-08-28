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
  installCommand: string;
};
const prismaConfig = readRepoFile("prisma.config.ts");

describe("Vercel build cutover", () => {
  it("собирает приложение без запуска миграций", () => {
    // `prisma generate` вызывается явно, потому что установка идёт с
    // `--ignore-scripts` и штатный `postinstall` не срабатывает (A51).
    // Генерация к БД не подключается — в отличие от `migrate deploy`,
    // который остаётся только в release-job с DIRECT_URL.
    expect(vercel.buildCommand).toBe("npx prisma generate && npm run build");
    expect(vercel.buildCommand).not.toContain("migrate");
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
