import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE_ROOT = path.resolve(process.cwd(), "src");
const DIRECT_DB_IMPORT = /\bfrom\s+["']@\/lib\/db["']/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "generated" ? [] : sourceFiles(absolute);
      }
      return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
    }),
  );
  return nested.flat();
}

function relativeSourcePath(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

describe("граница scoped DB API", () => {
  it("не допускает новых прямых импортов глобального Prisma Client", async () => {
    const importers: string[] = [];
    for (const file of await sourceFiles(SOURCE_ROOT)) {
      if (DIRECT_DB_IMPORT.test(await readFile(file, "utf8"))) {
        importers.push(relativeSourcePath(file));
      }
    }

    expect(importers.sort()).toEqual([
      "src/auth.ts",
      "src/lib/allowed-email.ts",
      "src/lib/app-settings.ts",
      "src/lib/notify.ts",
      "src/lib/scoped-db.ts",
    ]);
  });

  it("не допускает tenant-read realtime helpers в production data plane", async () => {
    const callers: string[] = [];
    for (const file of await sourceFiles(SOURCE_ROOT)) {
      const relative = relativeSourcePath(file);
      if (relative === "src/lib/notify.ts") continue;
      if (/\bnotifyLists?Members\s*\(/.test(await readFile(file, "utf8"))) {
        callers.push(relative);
      }
    }

    expect(callers).toEqual([]);
  });

  it("не допускает возврат перенесённых actions к глобальному Prisma", async () => {
    const actionsPath = path.join(
      SOURCE_ROOT,
      "app",
      "actions",
      "index.ts",
    );
    const source = await readFile(actionsPath, "utf8");

    for (const actionName of [
      "createGroup",
      "deleteGroup",
      "renameGroup",
      "moveGroup",
      "moveListInGroup",
      "addListToGroup",
      "removeListFromGroup",
      "createList",
      "deleteList",
      "setListAiEnabled",
      "renameList",
      "shareList",
      "removeSharedUser",
      "leaveSharedList",
      "updateItemNote",
      "updateListNote",
      "addItem",
      "deleteItem",
      "toggleItem",
      "renameItem",
      "moveItem",
      "moveItemToList",
    ]) {
      const marker = `export async function ${actionName}(`;
      const start = source.indexOf(marker);
      const next = source.indexOf("\nexport async function ", start + marker.length);
      const action = source.slice(start, next === -1 ? undefined : next);

      expect(start, `${actionName} должен существовать`).toBeGreaterThanOrEqual(0);
      expect(action, `${actionName} должен использовать scoped DB`).toContain(
        "withSpaceDb(",
      );
      expect(action, `${actionName} не должен использовать global prisma`).not.toMatch(
        /\bprisma\./,
      );
      expect(
        action,
        `${actionName} не должен читать tenant-таблицы из realtime after`,
      ).not.toMatch(/\bnotifyLists?Members\(/);
    }
  });
});
