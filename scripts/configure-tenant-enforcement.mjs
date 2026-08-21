import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  ALL_TABLE_PRIVILEGES,
  DATABASE_ROLES,
  EXPECTED_POLICIES,
  EXPECTED_ROUTINES,
  EXPECTED_TABLES,
  EXPECTED_TRIGGERS,
  RUNTIME_TABLE_PRIVILEGES,
} from "./database-role-contract.mjs";

const { Client } = pg;

export const TENANT_TABLES = [
  "Space",
  "List",
  "ListShare",
  "ListGroup",
  "_ListGroupMembers",
  "Item",
  "Attachment",
  "UserDailyUsage",
];

export const ENFORCEMENT_OPERATIONS = {
  "enable-usage-canary": {
    allowedProfiles: ["disabled", "usage-canary"],
    targetProfile: "usage-canary",
  },
  "rollback-usage-canary": {
    allowedProfiles: ["usage-canary", "disabled"],
    targetProfile: "disabled",
  },
};

const PROFILE_TABLES = {
  disabled: [],
  "usage-canary": ["UserDailyUsage"],
};
const GUARD_NAME = "app_tenant_update_columns_guard";
const USAGE_POLICY_PREDICATE =
  '("userId" = NULLIF(current_setting(\'app.user_id\'::text, true), \'\'::text))';

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertSameValues(actual, expected, label) {
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label} не совпадает. Ожидалось: ${expectedSorted.join(", ") || "∅"}; ` +
        `получено: ${actualSorted.join(", ") || "∅"}.`,
    );
  }
}

function fingerprint(hostname) {
  return createHash("sha256").update(hostname).digest("hex").slice(0, 12);
}

export function parseEnforcementArguments(args) {
  const allowedFlags = new Set(["--apply"]);
  const operationArguments = args.filter((argument) =>
    argument.startsWith("--operation="),
  );
  const unexpected = args.filter(
    (argument) =>
      !allowedFlags.has(argument) && !argument.startsWith("--operation="),
  );

  if (unexpected.length > 0) {
    throw new Error(`Неизвестные аргументы: ${unexpected.join(", ")}.`);
  }
  if (operationArguments.length !== 1) {
    throw new Error("Требуется ровно один аргумент --operation=<operation>.");
  }

  const operation = operationArguments[0].slice("--operation=".length);
  if (!Object.hasOwn(ENFORCEMENT_OPERATIONS, operation)) {
    throw new Error(`Неизвестная enforcement operation: ${operation}.`);
  }

  return { apply: args.includes("--apply"), operation };
}

export function identifyEnforcementProfile(rlsEnabled, guardsEnabled) {
  const actualRls = sorted(rlsEnabled);
  const actualGuards = sorted(guardsEnabled);

  for (const [profile, tables] of Object.entries(PROFILE_TABLES)) {
    const expected = sorted(tables);
    if (
      JSON.stringify(actualRls) === JSON.stringify(expected) &&
      JSON.stringify(actualGuards) === JSON.stringify(expected)
    ) {
      return profile;
    }
  }

  throw new Error(
    "Текущее состояние RLS/guards не соответствует известному rollout-профилю: " +
      `RLS=${actualRls.join(", ") || "∅"}; ` +
      `guards=${actualGuards.join(", ") || "∅"}.`,
  );
}

export function resolveEnforcementTransition(operation, currentProfile) {
  const contract = ENFORCEMENT_OPERATIONS[operation];
  if (!contract) {
    throw new Error(`Неизвестная enforcement operation: ${operation}.`);
  }
  if (!contract.allowedProfiles.includes(currentProfile)) {
    throw new Error(
      `Операция ${operation} запрещена из профиля ${currentProfile}.`,
    );
  }
  return {
    targetProfile: contract.targetProfile,
    changed: currentProfile !== contract.targetProfile,
    tables: [...PROFILE_TABLES[contract.targetProfile]],
  };
}

function assertInputs(connectionString, expectedHost) {
  if (!connectionString) throw new Error("DIRECT_URL is required.");
  if (!expectedHost) throw new Error("EXPECTED_DATABASE_HOST is required.");

  const url = new URL(connectionString);
  const actualHost = url.hostname.toLowerCase();
  const normalizedExpected = expectedHost.trim().toLowerCase();
  if (actualHost !== normalizedExpected) {
    throw new Error("DIRECT_URL host does not match EXPECTED_DATABASE_HOST.");
  }
  if (actualHost.includes("-pooler")) {
    throw new Error("DIRECT_URL must use a direct endpoint, not a pooler.");
  }
  return url;
}

async function queryCatalog(client) {
  const connection = await client.query(`
    SELECT current_user AS current_user, session_user AS session_user
  `);
  const runtimeRole = await client.query(
    `SELECT rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
            rolreplication, rolbypassrls, rolconfig
     FROM pg_roles
     WHERE rolname = $1`,
    [DATABASE_ROLES.runtime],
  );
  const runtimeMemberships = await client.query(
    `SELECT parent.rolname AS granted_role
     FROM pg_auth_members membership
     JOIN pg_roles member ON member.oid = membership.member
     JOIN pg_roles parent ON parent.oid = membership.roleid
     WHERE member.rolname = $1
     ORDER BY parent.rolname`,
    [DATABASE_ROLES.runtime],
  );
  const runtimeBoundary = await client.query(
    `SELECT
       has_database_privilege($1, current_database(), 'CONNECT') AS connect,
       has_database_privilege($1, current_database(), 'CREATE') AS database_create,
       has_schema_privilege($1, 'public', 'USAGE') AS schema_usage,
       has_schema_privilege($1, 'public', 'CREATE') AS schema_create`,
    [DATABASE_ROLES.runtime],
  );
  const relations = await client.query(`
    SELECT relation.relname AS name,
           pg_get_userbyid(relation.relowner) AS owner,
           relation.relrowsecurity AS rls_enabled,
           relation.relforcerowsecurity AS rls_forced
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
    ORDER BY relation.relname
  `);
  const runtimePrivileges = await client.query(
    `SELECT relation.relname AS name,
            ARRAY(
              SELECT privilege
              FROM unnest($2::text[]) AS privilege
              WHERE has_table_privilege($1, relation.oid, privilege)
              ORDER BY privilege
            ) AS privileges
     FROM pg_class relation
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind IN ('r', 'p')
     ORDER BY relation.relname`,
    [DATABASE_ROLES.runtime, ALL_TABLE_PRIVILEGES],
  );
  const routines = await client.query(`
    SELECT CASE routine.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind,
           routine.proname AS name,
           pg_get_function_identity_arguments(routine.oid) AS arguments,
           pg_get_userbyid(routine.proowner) AS owner
    FROM pg_proc routine
    JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
    ORDER BY name, arguments
  `);
  const policies = await client.query(`
    SELECT format(
             '%s:%s:%s:%s:%s',
             tablename, policyname, cmd, permissive, array_to_string(roles, ',')
           ) AS signature,
           tablename,
           policyname,
           cmd,
           qual,
           with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);
  const triggers = await client.query(`
    SELECT relation.relname AS table_name,
           trigger.tgname AS name,
           routine.proname AS function_name,
           trigger.tgenabled AS enabled
    FROM pg_trigger trigger
    JOIN pg_class relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_proc routine ON routine.oid = trigger.tgfoid
    WHERE namespace.nspname = 'public'
      AND NOT trigger.tgisinternal
    ORDER BY relation.relname, trigger.tgname
  `);

  return {
    connection: connection.rows[0],
    runtimeRole: runtimeRole.rows[0],
    runtimeMemberships: runtimeMemberships.rows,
    runtimeBoundary: runtimeBoundary.rows[0],
    relations: relations.rows,
    runtimePrivileges: runtimePrivileges.rows,
    routines: routines.rows,
    policies: policies.rows,
    triggers: triggers.rows,
  };
}

function assertUsagePolicies(policies) {
  const usagePolicies = policies.filter(
    (policy) => policy.tablename === "UserDailyUsage",
  );
  const byCommand = Object.fromEntries(
    usagePolicies.map((policy) => [policy.cmd, policy]),
  );

  for (const command of ["SELECT", "DELETE"]) {
    if (
      byCommand[command]?.qual !== USAGE_POLICY_PREDICATE ||
      byCommand[command]?.with_check !== null
    ) {
      throw new Error(`UserDailyUsage ${command} policy predicate не совпадает.`);
    }
  }
  if (
    byCommand.INSERT?.qual !== null ||
    byCommand.INSERT?.with_check !== USAGE_POLICY_PREDICATE
  ) {
    throw new Error("UserDailyUsage INSERT policy predicate не совпадает.");
  }
  if (
    byCommand.UPDATE?.qual !== USAGE_POLICY_PREDICATE ||
    byCommand.UPDATE?.with_check !== USAGE_POLICY_PREDICATE
  ) {
    throw new Error("UserDailyUsage UPDATE policy predicate не совпадает.");
  }
}

function assertCatalog(catalog) {
  if (
    catalog.connection?.session_user !== DATABASE_ROLES.migrator ||
    catalog.connection?.current_user !== DATABASE_ROLES.owner
  ) {
    throw new Error(
      "Enforcement requires smartlists_migrator with current role smartlists_owner.",
    );
  }

  const role = catalog.runtimeRole;
  if (
    !role?.rolcanlogin ||
    role.rolsuper ||
    role.rolinherit ||
    role.rolcreaterole ||
    role.rolcreatedb ||
    role.rolreplication ||
    role.rolbypassrls ||
    role.rolconfig !== null
  ) {
    throw new Error("Runtime role attributes do not match the restricted contract.");
  }
  if (catalog.runtimeMemberships.length !== 0) {
    throw new Error("Runtime role unexpectedly inherits another role.");
  }
  const boundary = catalog.runtimeBoundary;
  if (
    !boundary?.connect ||
    boundary.database_create ||
    !boundary.schema_usage ||
    boundary.schema_create
  ) {
    throw new Error("Runtime database/schema boundary does not match the contract.");
  }

  assertSameValues(
    catalog.relations.map((relation) => relation.name),
    EXPECTED_TABLES,
    "Таблицы public",
  );
  if (
    catalog.relations.some(
      (relation) =>
        relation.owner !== DATABASE_ROLES.owner || relation.rls_forced,
    )
  ) {
    throw new Error("Table ownership либо FORCE RLS не совпадает с контрактом.");
  }

  const actualPrivileges = Object.fromEntries(
    catalog.runtimePrivileges.map((relation) => [
      relation.name,
      sorted(relation.privileges),
    ]),
  );
  const expectedPrivileges = Object.fromEntries(
    Object.entries(RUNTIME_TABLE_PRIVILEGES).map(([table, privileges]) => [
      table,
      sorted(privileges),
    ]),
  );
  if (JSON.stringify(actualPrivileges) !== JSON.stringify(expectedPrivileges)) {
    throw new Error("Runtime table privileges do not match the contract.");
  }

  assertSameValues(
    catalog.routines.map(
      (routine) => `${routine.kind}:${routine.name}(${routine.arguments})`,
    ),
    EXPECTED_ROUTINES,
    "Routines public",
  );
  if (catalog.routines.some((routine) => routine.owner !== DATABASE_ROLES.owner)) {
    throw new Error("Routine ownership does not match the contract.");
  }
  assertSameValues(
    catalog.policies.map((policy) => policy.signature),
    EXPECTED_POLICIES,
    "Policies public",
  );
  assertUsagePolicies(catalog.policies);

  const expectedTriggerDefinitions = EXPECTED_TRIGGERS.map((trigger) =>
    trigger.split(":").slice(0, 3).join(":"),
  );
  assertSameValues(
    catalog.triggers.map(
      (trigger) =>
        `${trigger.table_name}:${trigger.name}:${trigger.function_name}`,
    ),
    expectedTriggerDefinitions,
    "Triggers public",
  );
}

function profileFromCatalog(catalog) {
  const tenantSet = new Set(TENANT_TABLES);
  const unexpectedRls = catalog.relations
    .filter((relation) => relation.rls_enabled && !tenantSet.has(relation.name))
    .map((relation) => relation.name);
  if (unexpectedRls.length > 0) {
    throw new Error(
      `RLS неожиданно включён вне tenant-контура: ${unexpectedRls.join(", ")}.`,
    );
  }

  const rlsEnabled = catalog.relations
    .filter((relation) => tenantSet.has(relation.name) && relation.rls_enabled)
    .map((relation) => relation.name);
  const guardsEnabled = catalog.triggers
    .filter((trigger) => trigger.enabled !== "D")
    .map((trigger) => {
      if (trigger.enabled !== "O" || trigger.name !== GUARD_NAME) {
        throw new Error(
          `Неожиданное состояние trigger ${trigger.table_name}:${trigger.enabled}.`,
        );
      }
      return trigger.table_name;
    });

  return identifyEnforcementProfile(rlsEnabled, guardsEnabled);
}

async function setProfile(client, currentProfile, targetProfile) {
  const currentTables = new Set(PROFILE_TABLES[currentProfile]);
  const targetTables = new Set(PROFILE_TABLES[targetProfile]);
  for (const table of TENANT_TABLES) {
    if (currentTables.has(table) === targetTables.has(table)) continue;

    const identifier = client.escapeIdentifier(table);
    const guardIdentifier = client.escapeIdentifier(GUARD_NAME);
    const action = targetTables.has(table) ? "ENABLE" : "DISABLE";
    await client.query(`ALTER TABLE public.${identifier} ${action} ROW LEVEL SECURITY`);
    await client.query(
      `ALTER TABLE public.${identifier} ${action} TRIGGER ${guardIdentifier}`,
    );
  }
}

export async function configureTenantEnforcement({
  args = process.argv.slice(2),
  connectionString = process.env.DIRECT_URL,
  expectedHost = process.env.EXPECTED_DATABASE_HOST,
} = {}) {
  const { apply, operation } = parseEnforcementArguments(args);
  const url = assertInputs(connectionString, expectedHost);
  const client = new Client({ connectionString });
  await client.connect();

  let transactionOpen = false;
  try {
    await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
    transactionOpen = true;
    if (apply) {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('smartlists_tenant_enforcement', 0))",
      );
    }

    const beforeCatalog = await queryCatalog(client);
    assertCatalog(beforeCatalog);
    const beforeProfile = profileFromCatalog(beforeCatalog);
    const transition = resolveEnforcementTransition(operation, beforeProfile);

    if (apply && transition.changed) {
      await setProfile(client, beforeProfile, transition.targetProfile);
      const changedCatalog = await queryCatalog(client);
      assertCatalog(changedCatalog);
      const changedProfile = profileFromCatalog(changedCatalog);
      if (changedProfile !== transition.targetProfile) {
        throw new Error("Post-change enforcement profile does not match target.");
      }
      await client.query("COMMIT");
      transactionOpen = false;
    } else {
      await client.query("ROLLBACK");
      transactionOpen = false;
    }

    const afterCatalog = await queryCatalog(client);
    assertCatalog(afterCatalog);
    const afterProfile = profileFromCatalog(afterCatalog);
    const expectedAfter = apply ? transition.targetProfile : beforeProfile;
    if (afterProfile !== expectedAfter) {
      throw new Error("Committed enforcement profile does not match expectation.");
    }

    const result = {
      mode: apply ? "apply" : "plan",
      operation,
      endpointFingerprint: fingerprint(url.hostname),
      beforeProfile,
      targetProfile: transition.targetProfile,
      afterProfile,
      changed: apply && transition.changed,
      rlsEnabled: [...PROFILE_TABLES[afterProfile]],
      guardsEnabled: [...PROFILE_TABLES[afterProfile]],
      forcedRls: [],
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) {
  configureTenantEnforcement().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
