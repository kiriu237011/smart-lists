import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const adminDatabaseUrl =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DIRECT_URL ??
  "postgresql://postgres:postgres@localhost:5433/smartlists_test";
const adminUrl = new URL(adminDatabaseUrl);
const runtimePassword = randomBytes(32).toString("base64url");
const runtimeUrl = new URL(adminDatabaseUrl);
runtimeUrl.username = "smartlists_runtime";
runtimeUrl.password = runtimePassword;

function run(command, args, env) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const baseEnv = {
  ...process.env,
  DIRECT_URL: adminDatabaseUrl,
  EXPECTED_DATABASE_HOST: adminUrl.hostname,
  RUNTIME_ROLE_PASSWORD: runtimePassword,
};

run(
  process.execPath,
  ["scripts/configure-runtime-role.mjs", "--apply", "--rotate-password"],
  baseEnv,
);

run(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.integration.config.ts"],
  {
    ...baseEnv,
    DATABASE_URL: runtimeUrl.toString(),
    TEST_ADMIN_DATABASE_URL: adminDatabaseUrl,
    EXPECT_RUNTIME_ROLE: "1",
  },
);
