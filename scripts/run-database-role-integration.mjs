import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

import pg from "pg";

import { DATABASE_ROLES, EXPECTED_TABLES } from "./database-role-contract.mjs";

const { Client } = pg;
const bootstrapDatabaseUrl =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DIRECT_URL ??
  "postgresql://postgres:postgres@localhost:5433/smartlists_test";
let adminDatabaseUrl = bootstrapDatabaseUrl;
const adminUrl = new URL(bootstrapDatabaseUrl);
const databaseName = adminUrl.pathname.slice(1);
const prismaCli = "node_modules/prisma/build/index.js";
const localAdminRole = "smartlists_test_admin";

function password() {
  return randomBytes(32).toString("base64url");
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} завершился с кодом ${result.status ?? 1}.`);
  }
}

function runExpectFailure(command, args, env, expectedMessage) {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0 || !output.includes(expectedMessage)) {
    throw new Error(
      `Ожидаемый fail-closed отказ «${expectedMessage}» не подтверждён.`,
    );
  }
}

function roleUrl(role, rolePassword) {
  const url = new URL(adminDatabaseUrl);
  url.username = role;
  url.password = rolePassword;
  return url.toString();
}

function assertLocalTestTarget() {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(adminUrl.hostname) || !/test/i.test(databaseName)) {
    throw new Error(
      "Operational role integration разрешён только для локальной test-БД.",
    );
  }
}

async function createLocalOperationalAdmin(rolePassword) {
  const client = new Client({ connectionString: bootstrapDatabaseUrl });
  await client.connect();
  try {
    const roleIdentifier = client.escapeIdentifier(localAdminRole);
    const databaseIdentifier = client.escapeIdentifier(databaseName);
    await client.query(
      `CREATE ROLE ${roleIdentifier} LOGIN ` +
        `PASSWORD ${client.escapeLiteral(rolePassword)} ` +
        "NOSUPERUSER INHERIT CREATEROLE CREATEDB REPLICATION BYPASSRLS",
    );
    await client.query(
      `ALTER DATABASE ${databaseIdentifier} OWNER TO ${roleIdentifier}`,
    );
  } finally {
    await client.end();
  }
  const url = new URL(bootstrapDatabaseUrl);
  url.username = localAdminRole;
  url.password = rolePassword;
  adminDatabaseUrl = url.toString();
}

async function recreateRestoreDatabase(name) {
  const maintenanceUrl = new URL(adminDatabaseUrl);
  maintenanceUrl.pathname = "/postgres";
  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const identifier = client.escapeIdentifier(name);
    await client.query(`DROP DATABASE IF EXISTS ${identifier}`);
    await client.query(`CREATE DATABASE ${identifier}`);
  } finally {
    await client.end();
  }
}

async function dropRestoreDatabase(name) {
  const maintenanceUrl = new URL(adminDatabaseUrl);
  maintenanceUrl.pathname = "/postgres";
  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }
}

function proveBackupAndRestore(backupUrl, restoreDatabase) {
  const source = new URL(backupUrl);
  const restore = new URL(adminDatabaseUrl);
  const dockerHost = process.platform === "win32"
    ? "host.docker.internal"
    : "127.0.0.1";
  const args = ["run", "--rm"];
  if (process.platform !== "win32") args.push("--network", "host");
  for (const variable of [
    "SOURCE_HOST",
    "SOURCE_PORT",
    "SOURCE_USER",
    "SOURCE_PASSWORD",
    "SOURCE_DATABASE",
    "RESTORE_HOST",
    "RESTORE_PORT",
    "RESTORE_USER",
    "RESTORE_PASSWORD",
    "RESTORE_DATABASE",
  ]) {
    args.push("-e", variable);
  }
  args.push(
    "postgres:17",
    "sh",
    "-ec",
    `PGHOST="$SOURCE_HOST" PGPORT="$SOURCE_PORT" PGUSER="$SOURCE_USER" ` +
      `PGPASSWORD="$SOURCE_PASSWORD" PGDATABASE="$SOURCE_DATABASE" ` +
      "PGSSLMODE=disable pg_dump --no-owner --no-privileges -Fc " +
      "-f /tmp/backup.dump && " +
      "pg_restore --list /tmp/backup.dump >/dev/null && " +
      `PGHOST="$RESTORE_HOST" PGPORT="$RESTORE_PORT" PGUSER="$RESTORE_USER" ` +
      `PGPASSWORD="$RESTORE_PASSWORD" PGDATABASE="$RESTORE_DATABASE" ` +
      "PGSSLMODE=disable pg_restore --no-owner --no-privileges " +
      '-d "$RESTORE_DATABASE" /tmp/backup.dump',
  );
  run("docker", args, {
    ...process.env,
    SOURCE_HOST: dockerHost,
    SOURCE_PORT: source.port || "5432",
    SOURCE_USER: source.username,
    SOURCE_PASSWORD: source.password,
    SOURCE_DATABASE: source.pathname.slice(1),
    RESTORE_HOST: dockerHost,
    RESTORE_PORT: restore.port || "5432",
    RESTORE_USER: restore.username,
    RESTORE_PASSWORD: restore.password,
    RESTORE_DATABASE: restoreDatabase,
  });
}

async function verifyRestoredInventory(restoreDatabase, proofValue) {
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${restoreDatabase}`;
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const result = await client.query(`
      SELECT relation.relname AS name
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind IN ('r', 'p')
      ORDER BY relation.relname
    `);
    const actual = result.rows.map((row) => row.name).sort();
    const expected = [...EXPECTED_TABLES].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Restored table inventory does not match the contract.");
    }
    const proof = await client.query(
      `SELECT value FROM "AppSetting" WHERE key = $1`,
      ["databaseRoleIntegrationProof"],
    );
    if (proof.rows[0]?.value !== proofValue) {
      throw new Error("Restored backup proof row is missing or corrupted.");
    }
  } finally {
    await client.end();
  }
}

async function seedBackupProof(migratorUrl, proofValue) {
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "AppSetting" (key, value, "updatedAt")
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, "updatedAt" = NOW()`,
      ["databaseRoleIntegrationProof", proofValue],
    );
  } finally {
    await client.end();
  }
}

async function proveUnexpectedOwnerMemberRejected(
  baseEnv,
  migratorPassword,
) {
  const unexpectedRole = "smartlists_unexpected_owner_member";
  const client = new Client({ connectionString: adminDatabaseUrl });
  await client.connect();
  try {
    await client.query(`DROP ROLE IF EXISTS ${client.escapeIdentifier(unexpectedRole)}`);
    await client.query(`CREATE ROLE ${client.escapeIdentifier(unexpectedRole)} NOLOGIN`);
    await client.query(
      `GRANT ${client.escapeIdentifier(DATABASE_ROLES.owner)} ` +
        `TO ${client.escapeIdentifier(unexpectedRole)} ` +
        "WITH ADMIN FALSE, SET FALSE, INHERIT FALSE",
    );
    runExpectFailure(
      process.execPath,
      ["scripts/configure-operational-roles.mjs", "--apply", "--scope=migration"],
      {
        ...baseEnv,
        MIGRATOR_ROLE_PASSWORD: migratorPassword,
      },
      "Owner members не совпадает",
    );
  } finally {
    await client.query(`DROP ROLE IF EXISTS ${client.escapeIdentifier(unexpectedRole)}`);
    await client.end();
  }
}

async function main() {
  assertLocalTestTarget();
  await createLocalOperationalAdmin(password());
  const initialRuntimePassword = password();
  const runtimePassword = password();
  const initialMigratorPassword = password();
  const migratorPassword = password();
  const initialBackupPassword = password();
  const backupPassword = password();
  const baseEnv = {
    ...process.env,
    DIRECT_URL: adminDatabaseUrl,
    EXPECTED_DATABASE_HOST: adminUrl.hostname,
  };

  // Чистая БД сначала получает схему владельцем. Configurator обязан видеть
  // полный inventory и откажется работать до миграций.
  run(process.execPath, [prismaCli, "migrate", "deploy"], baseEnv);

  run(
    process.execPath,
    ["scripts/configure-runtime-role.mjs", "--apply", "--rotate-password"],
    { ...baseEnv, RUNTIME_ROLE_PASSWORD: initialRuntimePassword },
  );

  run(
    process.execPath,
    ["scripts/configure-runtime-role.mjs", "--apply", "--rotate-password"],
    { ...baseEnv, RUNTIME_ROLE_PASSWORD: runtimePassword },
  );
  run(
    process.execPath,
    [
      "scripts/configure-operational-roles.mjs",
      "--apply",
      "--scope=migration",
      "--rotate-migrator-password",
    ],
    {
      ...baseEnv,
      MIGRATOR_ROLE_PASSWORD: initialMigratorPassword,
    },
  );
  run(
    process.execPath,
    [
      "scripts/configure-operational-roles.mjs",
      "--apply",
      "--scope=migration",
      "--rotate-migrator-password",
    ],
    {
      ...baseEnv,
      MIGRATOR_ROLE_PASSWORD: migratorPassword,
    },
  );

  await proveUnexpectedOwnerMemberRejected(
    baseEnv,
    migratorPassword,
  );

  const migratorDatabaseUrl = roleUrl(DATABASE_ROLES.migrator, migratorPassword);
  const runtimeDatabaseUrl = roleUrl(DATABASE_ROLES.runtime, runtimePassword);
  const backupDatabaseUrl = roleUrl(DATABASE_ROLES.backup, backupPassword);

  // Это ровно release-путь: login migrator автоматически становится NOLOGIN
  // owner. На уже актуальной схеме Prisma обязан вернуть no-op.
  run(process.execPath, [prismaCli, "migrate", "deploy"], {
    ...baseEnv,
    DIRECT_URL: migratorDatabaseUrl,
  });

  run(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.integration.config.ts",
    ],
    {
      ...baseEnv,
      DATABASE_URL: runtimeDatabaseUrl,
      DIRECT_URL: migratorDatabaseUrl,
      TEST_ADMIN_DATABASE_URL: migratorDatabaseUrl,
      EXPECT_RUNTIME_ROLE: "1",
    },
  );

  // Backup — отдельный production-only scope. Preview migration cutover не
  // должен заодно создавать credential, который там никогда не используется.
  run(
    process.execPath,
    [
      "scripts/configure-operational-roles.mjs",
      "--apply",
      "--scope=backup",
      "--rotate-backup-password",
    ],
    { ...baseEnv, BACKUP_ROLE_PASSWORD: initialBackupPassword },
  );
  run(
    process.execPath,
    [
      "scripts/configure-operational-roles.mjs",
      "--apply",
      "--scope=backup",
      "--rotate-backup-password",
    ],
    { ...baseEnv, BACKUP_ROLE_PASSWORD: backupPassword },
  );

  const restoreDatabase = `${databaseName}_restore_test`;
  const proofValue = randomBytes(24).toString("hex");
  await seedBackupProof(migratorDatabaseUrl, proofValue);
  await recreateRestoreDatabase(restoreDatabase);
  try {
    proveBackupAndRestore(backupDatabaseUrl, restoreDatabase);
    await verifyRestoredInventory(restoreDatabase, proofValue);
  } finally {
    await dropRestoreDatabase(restoreDatabase);
  }

  console.log(JSON.stringify({
    mode: "database-role-integration-passed",
    migrationsAsMigrator: "no-op",
    runtimeIntegration: "passed",
    unexpectedOwnerMember: "rejected",
    backupRestore: "passed",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
