import { pathToFileURL } from "node:url";

import pg from "pg";

import { verifyReleaseDatabaseTarget } from "./verify-release-database.mjs";

const { Client } = pg;

export const AUDIT_RETENTION_DAYS = 180;
export const AUDIT_RETENTION_CONFIRMATION =
  "delete-audit-events-older-than-180-days";

export function assertAuditRetentionRequest({
  apply,
  confirmation,
  directUrl,
  expectedHost,
  expectedRole,
}) {
  if (!apply) throw new Error("Audit retention требует явный флаг --apply");
  if (confirmation !== AUDIT_RETENTION_CONFIRMATION) {
    throw new Error("Audit retention confirmation не совпадает");
  }
  if (!expectedRole) {
    throw new Error("EXPECTED_DATABASE_ROLE не задан");
  }

  verifyReleaseDatabaseTarget(directUrl, expectedHost);
}

export async function pruneAuditEvents({
  directUrl,
  expectedHost,
  expectedRole,
  confirmation,
  apply,
}) {
  assertAuditRetentionRequest({
    apply,
    confirmation,
    directUrl,
    expectedHost,
    expectedRole,
  });

  const client = new Client({ connectionString: directUrl });
  try {
    await client.connect();
    const identity = await client.query("SELECT session_user AS session_user");
    const sessionUser = identity.rows[0]?.session_user;
    if (sessionUser !== expectedRole) {
      throw new Error("Audit retention database role не совпадает с ожидаемой");
    }

    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const result = await client.query(
      "SELECT public.app_prune_audit_events() AS deleted_count",
    );
    await client.query("COMMIT");

    const deletedCount = Number(result.rows[0]?.deleted_count ?? 0);
    if (!Number.isSafeInteger(deletedCount) || deletedCount < 0) {
      throw new Error("Audit retention вернул некорректный счётчик");
    }
    return deletedCount;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Соединение могло оборваться до начала транзакции; исходная ошибка важнее.
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function run() {
  try {
    const deletedCount = await pruneAuditEvents({
      directUrl: process.env.DIRECT_URL,
      expectedHost: process.env.EXPECTED_DATABASE_HOST,
      expectedRole: process.env.EXPECTED_DATABASE_ROLE,
      confirmation: process.env.AUDIT_RETENTION_CONFIRMATION,
      apply: process.argv.includes("--apply"),
    });
    console.log(
      `Audit retention complete: ${deletedCount} event(s) older than ${AUDIT_RETENTION_DAYS} days deleted`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "неизвестная ошибка";
    console.error("::error::" + message);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) await run();
