import pg from "pg";
import { createHash } from "node:crypto";

const { Client } = pg;

const connectionString =
  process.env.AUDIT_DATABASE_URL ??
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL;

if (!connectionString) {
  console.error("AUDIT_DATABASE_URL, DIRECT_URL or DATABASE_URL is required.");
  process.exit(1);
}

const client = new Client({ connectionString });
const databaseUrl = new URL(connectionString);
const endpointFingerprint = createHash("sha256")
  .update(databaseUrl.hostname)
  .digest("hex")
  .slice(0, 12);

async function rows(sql) {
  const result = await client.query(sql);
  return result.rows;
}

try {
  await client.connect();
  await client.query("BEGIN READ ONLY");

  const [connection] = await rows(`
    SELECT
      current_database() AS database,
      current_user AS current_user,
      session_user AS session_user
  `);

  const roles = await rows(`
    WITH RECURSIVE inherited_roles AS (
      SELECT oid, rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
             rolcanlogin, rolreplication, rolbypassrls
      FROM pg_roles
      WHERE rolname = current_user

      UNION

      SELECT parent.oid, parent.rolname, parent.rolsuper, parent.rolinherit,
             parent.rolcreaterole, parent.rolcreatedb, parent.rolcanlogin,
             parent.rolreplication, parent.rolbypassrls
      FROM inherited_roles child
      JOIN pg_auth_members membership ON membership.member = child.oid
      JOIN pg_roles parent ON parent.oid = membership.roleid
    )
    SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
           rolcanlogin, rolreplication, rolbypassrls
    FROM inherited_roles
    ORDER BY rolname
  `);

  const [databasePrivileges] = await rows(`
    SELECT
      has_database_privilege(current_user, current_database(), 'CONNECT') AS connect,
      has_database_privilege(current_user, current_database(), 'CREATE') AS create,
      has_database_privilege(current_user, current_database(), 'TEMP') AS temporary
  `);

  const [schema] = await rows(`
    SELECT
      namespace.nspname AS schema,
      pg_get_userbyid(namespace.nspowner) AS owner,
      has_schema_privilege(current_user, namespace.oid, 'USAGE') AS usage,
      has_schema_privilege(current_user, namespace.oid, 'CREATE') AS create,
      namespace.nspacl::text AS acl
    FROM pg_namespace namespace
    WHERE namespace.nspname = 'public'
  `);

  const relations = await rows(`
    SELECT
      relation.relname AS name,
      CASE relation.relkind
        WHEN 'r' THEN 'table'
        WHEN 'p' THEN 'partitioned table'
        WHEN 'S' THEN 'sequence'
        WHEN 'v' THEN 'view'
        WHEN 'm' THEN 'materialized view'
        ELSE relation.relkind::text
      END AS kind,
      pg_get_userbyid(relation.relowner) AS owner,
      relation.relrowsecurity AS rls_enabled,
      relation.relforcerowsecurity AS rls_forced,
      has_table_privilege(current_user, relation.oid, 'SELECT') AS select,
      has_table_privilege(current_user, relation.oid, 'INSERT') AS insert,
      has_table_privilege(current_user, relation.oid, 'UPDATE') AS update,
      has_table_privilege(current_user, relation.oid, 'DELETE') AS delete,
      has_table_privilege(current_user, relation.oid, 'TRUNCATE') AS truncate,
      has_table_privilege(current_user, relation.oid, 'REFERENCES') AS references,
      has_table_privilege(current_user, relation.oid, 'TRIGGER') AS trigger
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'S', 'v', 'm')
    ORDER BY kind, name
  `);

  const policies = await rows(`
    SELECT schemaname, tablename, policyname, permissive, roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);

  const defaultPrivileges = await rows(`
    SELECT
      pg_get_userbyid(defaults.defaclrole) AS owner,
      namespace.nspname AS schema,
      defaults.defaclobjtype AS object_type,
      defaults.defaclacl::text AS acl
    FROM pg_default_acl defaults
    LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
    WHERE namespace.nspname = 'public' OR defaults.defaclnamespace = 0
    ORDER BY owner, schema, object_type
  `);

  console.log(JSON.stringify({
    target: {
      endpointFingerprint,
      pooled: databaseUrl.hostname.includes("-pooler."),
    },
    connection,
    roles,
    databasePrivileges,
    schema,
    relations,
    policies,
    defaultPrivileges,
  }, null, 2));

  await client.query("ROLLBACK");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Соединение могло завершиться до начала транзакции.
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
