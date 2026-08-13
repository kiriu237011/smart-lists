import pg from "pg";
import { createHash } from "node:crypto";

import {
  ALL_TABLE_PRIVILEGES,
  DATABASE_ROLES,
  EXPECTED_TABLES,
  RUNTIME_TABLE_PRIVILEGES,
} from "./database-role-contract.mjs";

const { Client } = pg;

const RUNTIME_ROLE = DATABASE_ROLES.runtime;

const apply = process.argv.includes("--apply");
const rotatePassword = process.argv.includes("--rotate-password");
const adminConnectionString = process.env.DIRECT_URL;
const expectedHost = process.env.EXPECTED_DATABASE_HOST;
const runtimePassword = process.env.RUNTIME_ROLE_PASSWORD;

function fingerprint(hostname) {
  return createHash("sha256").update(hostname).digest("hex").slice(0, 12);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertSameValues(actual, expected, label) {
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label} не совпадает. Ожидалось: ${expectedSorted.join(", ")}; ` +
        `получено: ${actualSorted.join(", ")}.`,
    );
  }
}

function assertInputs() {
  if (!adminConnectionString) {
    throw new Error("DIRECT_URL is required.");
  }
  if (!expectedHost) {
    throw new Error("EXPECTED_DATABASE_HOST is required.");
  }
  if (apply && !runtimePassword) {
    throw new Error("RUNTIME_ROLE_PASSWORD is required.");
  }

  const adminUrl = new URL(adminConnectionString);
  if (adminUrl.hostname !== expectedHost) {
    throw new Error("DIRECT_URL host does not match EXPECTED_DATABASE_HOST.");
  }
  if (adminUrl.hostname.includes("-pooler.")) {
    throw new Error("DIRECT_URL must use a direct Neon endpoint, not a pooler.");
  }
  if (runtimePassword && runtimePassword.length < 32) {
    throw new Error("RUNTIME_ROLE_PASSWORD must contain at least 32 characters.");
  }

  return adminUrl;
}

async function listPublicTables(client) {
  const result = await client.query(`
    SELECT relation.relname AS name
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
    ORDER BY relation.relname
  `);
  return result.rows.map((row) => row.name);
}

async function assertExistingRuntimeRoleIsRestricted(client) {
  const roleResult = await client.query(
    `SELECT rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolreplication, rolbypassrls
     FROM pg_roles
     WHERE rolname = $1`,
    [RUNTIME_ROLE],
  );
  const role = roleResult.rows[0];

  if (
    !role?.rolcanlogin ||
    role.rolsuper ||
    role.rolinherit ||
    role.rolcreaterole ||
    role.rolcreatedb ||
    role.rolreplication ||
    role.rolbypassrls
  ) {
    throw new Error(
      "Existing runtime role has unsafe attributes; refusing to change it automatically.",
    );
  }

  const membershipResult = await client.query(
    `SELECT 1
     FROM pg_auth_members membership
     JOIN pg_roles member ON member.oid = membership.member
     WHERE member.rolname = $1`,
    [RUNTIME_ROLE],
  );
  if (membershipResult.rowCount !== 0) {
    throw new Error(
      "Existing runtime role has memberships; refusing to change it automatically.",
    );
  }
}

async function verifyRuntimeRole(connectionString) {
  const runtimeClient = new Client({ connectionString });
  await runtimeClient.connect();

  try {
    await runtimeClient.query("BEGIN READ ONLY");

    const roleResult = await runtimeClient.query(`
      SELECT current_user AS role, rolsuper, rolcreaterole, rolcreatedb,
             rolreplication, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user
    `);
    const role = roleResult.rows[0];
    if (!role || role.role !== RUNTIME_ROLE) {
      throw new Error("Runtime verification connected under an unexpected role.");
    }
    if (
      role.rolsuper ||
      role.rolcreaterole ||
      role.rolcreatedb ||
      role.rolreplication ||
      role.rolbypassrls
    ) {
      throw new Error("Runtime role has a forbidden role attribute.");
    }

    const membershipResult = await runtimeClient.query(`
      SELECT parent.rolname
      FROM pg_auth_members membership
      JOIN pg_roles member ON member.oid = membership.member
      JOIN pg_roles parent ON parent.oid = membership.roleid
      WHERE member.rolname = current_user
    `);
    if (membershipResult.rowCount !== 0) {
      throw new Error("Runtime role unexpectedly inherits another role.");
    }

    const boundaryResult = await runtimeClient.query(`
      SELECT
        has_database_privilege(current_user, current_database(), 'CONNECT') AS connect,
        has_database_privilege(current_user, current_database(), 'CREATE') AS create_database,
        has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
        has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create
    `);
    const boundary = boundaryResult.rows[0];
    if (
      !boundary.connect ||
      boundary.create_database ||
      !boundary.schema_usage ||
      boundary.schema_create
    ) {
      throw new Error("Runtime database/schema boundary does not match the contract.");
    }

    for (const table of EXPECTED_TABLES) {
      const privilegeResult = await runtimeClient.query(
        `SELECT privilege
         FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         CROSS JOIN unnest($2::text[]) AS privilege
         WHERE namespace.nspname = 'public'
           AND relation.relname = $1
           AND has_table_privilege(current_user, relation.oid, privilege)`,
        [table, ALL_TABLE_PRIVILEGES],
      );
      assertSameValues(
        privilegeResult.rows.map((row) => row.privilege),
        RUNTIME_TABLE_PRIVILEGES[table],
        `Права runtime на ${table}`,
      );
    }

    await runtimeClient.query("ROLLBACK");
  } catch (error) {
    await runtimeClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await runtimeClient.end();
  }
}

async function main() {
  const adminUrl = assertInputs();

  if (!apply) {
    console.log(JSON.stringify({
      mode: "plan-only",
      role: RUNTIME_ROLE,
      endpointFingerprint: fingerprint(adminUrl.hostname),
      rotatePassword,
      tablePrivileges: RUNTIME_TABLE_PRIVILEGES,
      denied: [
        "database CREATE",
        "schema CREATE",
        "ownership",
        "role membership",
        "BYPASSRLS",
        "CREATEROLE",
        "CREATEDB",
        "REPLICATION",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
        "all privileges on _prisma_migrations",
      ],
    }, null, 2));
    return;
  }

  const client = new Client({ connectionString: adminConnectionString });
  await client.connect();

  let roleCreated = false;
  try {
    await client.query("BEGIN");

    assertSameValues(
      await listPublicTables(client),
      EXPECTED_TABLES,
      "Набор таблиц public",
    );

    const roleResult = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [RUNTIME_ROLE],
    );
    const roleIdentifier = client.escapeIdentifier(RUNTIME_ROLE);
    const passwordLiteral = client.escapeLiteral(runtimePassword);

    if (roleResult.rowCount === 0) {
      await client.query(
        `CREATE ROLE ${roleIdentifier} LOGIN PASSWORD ${passwordLiteral} ` +
          "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS",
      );
      roleCreated = true;
    } else {
      await assertExistingRuntimeRoleIsRestricted(client);
      if (rotatePassword) {
        await client.query(
          `ALTER ROLE ${roleIdentifier} PASSWORD ${passwordLiteral}`,
        );
      }
    }

    const databaseResult = await client.query(
      "SELECT current_database() AS database, current_user AS owner_role",
    );
    const databaseIdentifier = client.escapeIdentifier(
      databaseResult.rows[0].database,
    );
    const ownerIdentifier = client.escapeIdentifier(
      databaseResult.rows[0].owner_role,
    );

    await client.query(
      `REVOKE ALL PRIVILEGES ON DATABASE ${databaseIdentifier} FROM ${roleIdentifier}`,
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${databaseIdentifier} TO ${roleIdentifier}`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${roleIdentifier}`,
    );
    await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdentifier}`);
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${roleIdentifier}`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${roleIdentifier}`,
    );
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${roleIdentifier}`,
    );

    for (const [table, privileges] of Object.entries(RUNTIME_TABLE_PRIVILEGES)) {
      if (privileges.length === 0) continue;
      await client.query(
        `GRANT ${privileges.join(", ")} ON TABLE ${client.escapeIdentifier(table)} ` +
          `TO ${roleIdentifier}`,
      );
    }

    for (const objectType of ["TABLES", "SEQUENCES", "FUNCTIONS"]) {
      await client.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerIdentifier} IN SCHEMA public ` +
          `REVOKE ALL PRIVILEGES ON ${objectType} FROM ${roleIdentifier}`,
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }

  const runtimeUrl = new URL(adminConnectionString);
  runtimeUrl.username = RUNTIME_ROLE;
  runtimeUrl.password = runtimePassword;
  await verifyRuntimeRole(runtimeUrl.toString());

  console.log(JSON.stringify({
    mode: "applied-and-verified",
    role: RUNTIME_ROLE,
    roleCreated,
    passwordRotated: !roleCreated && rotatePassword,
    endpointFingerprint: fingerprint(adminUrl.hostname),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
