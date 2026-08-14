/**
 * @file runtime-database-privileges.int.test.ts
 * @description Контракт PostgreSQL-роли приложения без DDL и лишних DML.
 *
 * Запускается только через `test:integration:runtime`: обычный integration
 * suite по умолчанию сохраняет владельческий URL для локальной разработки.
 */

import { PrismaAdapter } from "@auth/prisma-adapter";
import { describe, expect, it } from "vitest";

import { prisma } from "./setup";

const runtimeDescribe =
  process.env.EXPECT_RUNTIME_ROLE === "1" ? describe : describe.skip;

runtimeDescribe("контракт restricted runtime-роли", () => {
  it("не имеет DDL, broad role attributes и доступа к migration metadata", async () => {
    const [role] = await prisma.$queryRaw<
      Array<{
        role: string;
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
        databaseCreate: boolean;
        schemaCreate: boolean;
      }>
    >`
      SELECT current_user AS role,
             roles.rolsuper,
             roles.rolcreaterole,
             roles.rolcreatedb,
             roles.rolreplication,
             roles.rolbypassrls,
             has_database_privilege(current_user, current_database(), 'CREATE') AS "databaseCreate",
             has_schema_privilege(current_user, 'public', 'CREATE') AS "schemaCreate"
      FROM pg_roles roles
      WHERE roles.rolname = current_user
    `;

    expect(role).toEqual({
      role: "smartlists_runtime",
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: false,
      databaseCreate: false,
      schemaCreate: false,
    });

    await expect(
      prisma.$executeRawUnsafe(
        'CREATE TABLE "__smartlists_runtime_ddl_probe" (id integer)',
      ),
    ).rejects.toThrow();
    await expect(
      prisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" LIMIT 1'),
    ).rejects.toThrow();
  });

  it("разрешает текущий Google OAuth/session поток Auth.js", async () => {
    const adapter = PrismaAdapter(prisma);
    const email = `runtime_auth_${crypto.randomUUID()}@example.com`;
    const user = await adapter.createUser!({
      // Prisma Adapter удаляет входной id и поручает генерацию Prisma, но
      // общий AdapterUser-контракт всё равно требует поле на границе метода.
      id: crypto.randomUUID(),
      name: "Runtime Auth",
      email,
      emailVerified: null,
      image: null,
    });

    expect((await adapter.getUserByEmail!(email))?.id).toBe(user.id);

    await adapter.updateUser!({ id: user.id, name: "Updated Runtime Auth" });
    await adapter.linkAccount!({
      userId: user.id,
      type: "oauth",
      provider: "google",
      providerAccountId: `provider_${crypto.randomUUID()}`,
    });

    const sessionToken = `session_${crypto.randomUUID()}`;
    await adapter.createSession!({
      sessionToken,
      userId: user.id,
      expires: new Date(Date.now() + 60_000),
    });
    expect((await adapter.getSessionAndUser!(sessionToken))?.user.id).toBe(user.id);

    await adapter.updateSession!({
      sessionToken,
      expires: new Date(Date.now() + 120_000),
    });
    expect((await adapter.deleteSession!(sessionToken))?.sessionToken).toBe(
      sessionToken,
    );
  });

  it("запрещает runtime менять глобальную конфигурацию и неиспользуемые auth-объекты", async () => {
    await expect(
      prisma.allowedEmail.create({
        data: { email: `forbidden_${crypto.randomUUID()}@example.com` },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.appSetting.create({
        data: { key: `forbidden_${crypto.randomUUID()}`, value: "true" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.verificationToken.create({
        data: {
          identifier: `forbidden_${crypto.randomUUID()}@example.com`,
          token: crypto.randomUUID(),
          expires: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });

  it("имеет EXECUTE только на fail-closed attachment helpers", async () => {
    const routines = await prisma.$queryRaw<
      Array<{
        name: string;
        arguments: string;
        runtimeExecute: boolean;
        publicExecute: boolean;
      }>
    >`
      SELECT routine.proname AS name,
             pg_get_function_identity_arguments(routine.oid) AS arguments,
             has_function_privilege(
               current_user,
               routine.oid,
               'EXECUTE'
             ) AS "runtimeExecute",
             COALESCE(
               bool_or(
                 privileges.grantee = 0
                 AND privileges.privilege_type = 'EXECUTE'
               ),
               false
             ) AS "publicExecute"
      FROM pg_proc routine
      JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
      LEFT JOIN LATERAL aclexplode(routine.proacl) privileges ON true
      WHERE namespace.nspname = 'public'
      GROUP BY routine.oid, routine.proname
      ORDER BY name, arguments
    `;

    expect(routines).toEqual([
      {
        name: "app_attachment_finish_maintenance",
        arguments: "uuid[], boolean",
        runtimeExecute: true,
        publicExecute: false,
      },
      {
        name: "app_attachment_prepare_maintenance",
        arguments: "text",
        runtimeExecute: true,
        publicExecute: false,
      },
    ]);

    await expect(
      prisma.$queryRaw`
        SELECT *
        FROM public.app_attachment_prepare_maintenance('missing-context')
      `,
    ).rejects.toThrow();
    await expect(
      prisma.$queryRaw`
        SELECT public.app_attachment_finish_maintenance(
          ARRAY[]::uuid[],
          false
        )
      `,
    ).rejects.toThrow();
  });
});
