import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DOCS_FAST_PATHS = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  "DATABASE_SECURITY.md",
  "PROJECT_MEMORY.md",
  "README.md",
  "THREAT_MODEL.md",
]);

const ALLOWED_PATHS = new Set(DOCS_FAST_PATHS);
const REGULAR_FILE_MODE = "100644";
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const SHA_PATTERN = /^[0-9a-f]{40,64}$/;

function full(reason) {
  return { mode: "full", reason };
}

function validateDocument(content) {
  if (!Buffer.isBuffer(content)) return "document-is-not-a-buffer";
  if (content.length > MAX_DOCUMENT_BYTES) return "document-is-too-large";
  if (content.includes(0)) return "document-contains-nul";

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return "document-is-not-utf8";
  }

  if (text.includes("\r")) return "document-is-not-lf";
  return null;
}

export function classifyChanges({
  eventName,
  fastPathEnabled,
  changes,
}) {
  if (fastPathEnabled !== "true") return full("fast-path-disabled");
  if (eventName !== "pull_request") return full("event-requires-full-ci");
  if (!Array.isArray(changes) || changes.length === 0) {
    return full("empty-or-invalid-diff");
  }

  for (const change of changes) {
    if (!change || typeof change.path !== "string") {
      return full("malformed-change");
    }
    if (!ALLOWED_PATHS.has(change.path)) {
      return full(`path-not-allowed:${change.path}`);
    }
    if (change.status !== "M") {
      return full(`status-not-allowed:${change.path}:${change.status}`);
    }
    if (
      change.baseMode !== REGULAR_FILE_MODE ||
      change.headMode !== REGULAR_FILE_MODE
    ) {
      return full(`mode-not-allowed:${change.path}`);
    }

    const contentError = validateDocument(change.content);
    if (contentError) return full(`${contentError}:${change.path}`);
  }

  return { mode: "docs", reason: "allowlisted-documents-only" };
}

function git(cwd, args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd,
    encoding,
    maxBuffer: 2 * MAX_DOCUMENT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function treeMode(cwd, revision, path) {
  const output = git(cwd, ["ls-tree", revision, "--", path]).trim();
  const match = output.match(/^(\d{6})\s+blob\s+[0-9a-f]+\t/);
  return match?.[1] ?? null;
}

export function classifyRepositoryDiff({
  cwd,
  eventName,
  fastPathEnabled,
  baseSha,
  headSha,
}) {
  if (fastPathEnabled !== "true" || eventName !== "pull_request") {
    return classifyChanges({ eventName, fastPathEnabled, changes: [] });
  }
  if (!SHA_PATTERN.test(baseSha ?? "") || !SHA_PATTERN.test(headSha ?? "")) {
    return full("invalid-revision");
  }

  try {
    const output = git(cwd, [
      "diff",
      "--name-status",
      "--no-renames",
      baseSha,
      headSha,
      "--",
    ]);
    const lines = output.length === 0 ? [] : output.trimEnd().split("\n");
    const changes = lines.map((line) => {
      const separator = line.indexOf("\t");
      if (separator < 1) return null;
      const status = line.slice(0, separator);
      const path = line.slice(separator + 1);
      return {
        status,
        path,
        baseMode: treeMode(cwd, baseSha, path),
        headMode: treeMode(cwd, headSha, path),
        content:
          status === "M"
            ? git(cwd, ["show", `${headSha}:${path}`], null)
            : Buffer.alloc(0),
      };
    });

    return classifyChanges({ eventName, fastPathEnabled, changes });
  } catch {
    return full("git-diff-failed");
  }
}

function requireResult(results, name, expected) {
  if (results[name] !== expected) {
    throw new Error(`${name}: ожидался ${expected}, получен ${results[name]}`);
  }
}

export function verifyGate({ mode, eventName, results }) {
  requireResult(results, "classify", "success");
  requireResult(results, "secrets", "success");

  if (eventName === "pull_request") {
    requireResult(results, "dependencyReview", "success");
  } else {
    requireResult(results, "dependencyReview", "skipped");
  }

  const heavyJobs = ["securityStatic", "checks", "integration", "e2e"];
  if (mode === "docs") {
    requireResult(results, "docs", "success");
    for (const job of heavyJobs) requireResult(results, job, "skipped");
    return;
  }
  if (mode === "full") {
    requireResult(results, "docs", "skipped");
    for (const job of heavyJobs) requireResult(results, job, "success");
    return;
  }

  throw new Error(`Неизвестный CI-режим: ${mode}`);
}

function writeOutput(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("GITHUB_OUTPUT не задан");
  appendFileSync(outputPath, `mode=${result.mode}\nreason=${result.reason}\n`, "utf8");
  console.log(JSON.stringify(result));
}

function main() {
  const command = process.argv[2];
  if (command === "classify") {
    writeOutput(
      classifyRepositoryDiff({
        cwd: process.cwd(),
        eventName: process.env.CI_EVENT_NAME,
        fastPathEnabled: process.env.CI_DOCS_FAST_PATH_ENABLED,
        baseSha: process.env.CI_BASE_SHA,
        headSha: process.env.CI_HEAD_SHA,
      }),
    );
    return;
  }
  if (command === "gate") {
    verifyGate({
      mode: process.env.CI_MODE,
      eventName: process.env.CI_EVENT_NAME,
      results: {
        classify: process.env.CI_CLASSIFY_RESULT,
        docs: process.env.CI_DOCS_RESULT,
        securityStatic: process.env.CI_SECURITY_STATIC_RESULT,
        checks: process.env.CI_CHECKS_RESULT,
        integration: process.env.CI_INTEGRATION_RESULT,
        e2e: process.env.CI_E2E_RESULT,
        secrets: process.env.CI_SECRETS_RESULT,
        dependencyReview: process.env.CI_DEPENDENCY_REVIEW_RESULT,
      },
    });
    console.log(`CI gate: режим ${process.env.CI_MODE} подтверждён`);
    return;
  }
  throw new Error("Ожидалась команда classify или gate");
}

const entryPoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : null;
if (entryPoint === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
