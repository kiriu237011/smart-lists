import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  addItem,
  addListToGroup,
  createGroup,
  createList,
  leaveSharedList,
  removeSharedUser,
  renameGroup,
  renameList,
  shareList,
} from "@/app/actions";
import {
  confirmUpload,
  deleteAttachment,
  requestUpload,
} from "@/app/actions/attachments";
import { createSpace } from "@/app/actions/spaces";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/prisma-client";
import { createScopedDatabase } from "@/lib/scoped-db";
import { formData } from "./factories";
import { prisma, setSessionUser } from "./setup";

const TENANT_TABLES = [
  "Space",
  "List",
  "ListShare",
  "ListGroup",
  "_ListGroupMembers",
  "Item",
  "Attachment",
  "UserDailyUsage",
] as const;

const GUARDED_TABLES = [...TENANT_TABLES];
const LIST_ITEM_PROFILE_TABLES = [
  "List",
  "Item",
  "UserDailyUsage",
] as const;
const SPACE_GROUPS_PROFILE_TABLES = [
  ...LIST_ITEM_PROFILE_TABLES,
  "Space",
  "ListGroup",
  "_ListGroupMembers",
] as const;

const EXPECTED_POLICY_COMMANDS: Record<(typeof TENANT_TABLES)[number], string[]> = {
  Space: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  List: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  ListShare: ["DELETE", "INSERT", "SELECT"],
  ListGroup: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  _ListGroupMembers: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  Item: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  Attachment: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  UserDailyUsage: ["DELETE", "INSERT", "SELECT", "UPDATE"],
};

describe("tenant RLS catalog до enforcement", () => {
  it("содержит полный policy catalog, но не включает RLS", async () => {
    const relations = await prisma.$queryRaw<
      Array<{ table: string; enabled: boolean; forced: boolean }>
    >`
      SELECT relation.relname AS table,
             relation.relrowsecurity AS enabled,
             relation.relforcerowsecurity AS forced
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = ANY(${TENANT_TABLES}::text[])
      ORDER BY relation.relname
    `;

    expect(relations).toHaveLength(TENANT_TABLES.length);
    expect(relations.every(({ enabled, forced }) => !enabled && !forced)).toBe(true);

    const policies = await prisma.$queryRaw<
      Array<{
        table: (typeof TENANT_TABLES)[number];
        command: string;
        permissive: string;
        roles: string[];
      }>
    >`
      SELECT tablename::text AS table,
             cmd::text AS command,
             permissive::text AS permissive,
             roles::text[] AS roles
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ANY(${TENANT_TABLES}::text[])
      ORDER BY tablename, cmd
    `;

    for (const table of TENANT_TABLES) {
      const tablePolicies = policies.filter((policy) => policy.table === table);
      expect(tablePolicies.map(({ command }) => command).sort()).toEqual(
        EXPECTED_POLICY_COMMANDS[table],
      );
      expect(
        tablePolicies.every(
          ({ permissive, roles }) =>
            permissive === "PERMISSIVE" &&
            roles.length === 1 &&
            roles[0] === "public",
        ),
      ).toBe(true);
    }
  });

  it("создаёт column guards выключенными", async () => {
    const triggers = await prisma.$queryRaw<
      Array<{ table: string; name: string; function: string; enabled: string }>
    >`
      SELECT relation.relname AS table,
             trigger.tgname AS name,
             routine.proname AS function,
             trigger.tgenabled::text AS enabled
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_proc routine ON routine.oid = trigger.tgfoid
      WHERE namespace.nspname = 'public'
        AND NOT trigger.tgisinternal
      ORDER BY relation.relname
    `;

    const guards = triggers.filter(
      (trigger) => trigger.name === "app_tenant_update_columns_guard",
    );
    expect(guards).toHaveLength(GUARDED_TABLES.length);
    expect(guards.map(({ table }) => table).sort()).toEqual(
      [...GUARDED_TABLES].sort(),
    );
    expect(
      guards.every(
        (trigger) =>
          trigger.function === "app_enforce_tenant_update_columns" &&
          trigger.enabled === "D",
      ),
    ).toBe(true);

    expect(
      triggers
        .filter((trigger) => trigger.name === "app_audit_global_admin_change")
        .map((trigger) => ({
          table: trigger.table,
          function: trigger.function,
          enabled: trigger.enabled,
        })),
    ).toEqual([
      {
        table: "AllowedEmail",
        function: "app_audit_global_admin_change",
        enabled: "O",
      },
      {
        table: "AppSetting",
        function: "app_audit_global_admin_change",
        enabled: "O",
      },
    ]);
  });
});

const runtimeDescribe =
  process.env.EXPECT_RUNTIME_ROLE === "1" ? describe : describe.skip;

const runtimeUrl = process.env.DATABASE_URL!;
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DIRECT_URL!;
const singleConnectionPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: runtimeUrl, max: 1 }),
});
const enforcementAdminPrisma = createPrismaClient(adminUrl);
const { withUserDb, withSpaceDb } = createScopedDatabase(singleConnectionPrisma);

async function seedFixture() {
  const ids = {
    alice: "rls_alice",
    bob: "rls_bob",
    mallory: "rls_mallory",
    aliceSpace: "space_default_rls_alice",
    bobSpace: "space_default_rls_bob",
    bobOtherSpace: "rls_space_bob_other",
    mallorySpace: "space_default_rls_mallory",
    aliceSharedList: "rls_list_alice_shared",
    alicePrivateList: "rls_list_alice_private",
    bobList: "rls_list_bob",
    bobOtherList: "rls_list_bob_other",
    malloryList: "rls_list_mallory",
    aliceGroup: "rls_group_alice",
    bobGroup: "rls_group_bob",
    sharedItem: "rls_item_shared",
    privateItem: "rls_item_private",
    bobItem: "rls_item_bob",
    malloryItem: "rls_item_mallory",
    sharedAttachment: "rls_attachment_shared",
    privateAttachment: "rls_attachment_private",
    bobAttachment: "rls_attachment_bob",
  } as const;

  await enforcementAdminPrisma.user.createMany({
    data: [
      { id: ids.alice, email: "rls-alice@test.local" },
      { id: ids.bob, email: "rls-bob@test.local" },
      { id: ids.mallory, email: "rls-mallory@test.local" },
    ],
  });
  await enforcementAdminPrisma.space.createMany({
    data: [
      { id: ids.aliceSpace, userId: ids.alice, isDefault: true },
      { id: ids.bobSpace, userId: ids.bob, isDefault: true },
      {
        id: ids.bobOtherSpace,
        userId: ids.bob,
        name: "Другое",
        normalizedName: "другое",
      },
      { id: ids.mallorySpace, userId: ids.mallory, isDefault: true },
    ],
  });
  await enforcementAdminPrisma.list.createMany({
    data: [
      {
        id: ids.aliceSharedList,
        ownerId: ids.alice,
        spaceId: ids.aliceSpace,
        title: "Alice shared",
      },
      {
        id: ids.alicePrivateList,
        ownerId: ids.alice,
        spaceId: ids.aliceSpace,
        title: "Alice private",
      },
      {
        id: ids.bobList,
        ownerId: ids.bob,
        spaceId: ids.bobSpace,
        title: "Bob",
      },
      {
        id: ids.bobOtherList,
        ownerId: ids.bob,
        spaceId: ids.bobOtherSpace,
        title: "Bob other",
      },
      {
        id: ids.malloryList,
        ownerId: ids.mallory,
        spaceId: ids.mallorySpace,
        title: "Mallory",
      },
    ],
  });
  await enforcementAdminPrisma.listShare.create({
    data: {
      listId: ids.aliceSharedList,
      userId: ids.bob,
      spaceId: ids.bobSpace,
    },
  });
  await enforcementAdminPrisma.listGroup.createMany({
    data: [
      {
        id: ids.aliceGroup,
        userId: ids.alice,
        spaceId: ids.aliceSpace,
        name: "Alice group",
        position: 1,
      },
      {
        id: ids.bobGroup,
        userId: ids.bob,
        spaceId: ids.bobSpace,
        name: "Bob group",
        position: 1,
      },
    ],
  });
  await enforcementAdminPrisma.listGroupMembership.createMany({
    data: [
      { listId: ids.aliceSharedList, groupId: ids.aliceGroup, position: 1 },
      { listId: ids.aliceSharedList, groupId: ids.bobGroup, position: 1 },
    ],
  });
  await enforcementAdminPrisma.item.createMany({
    data: [
      {
        id: ids.sharedItem,
        listId: ids.aliceSharedList,
        name: "Shared item",
        position: 1,
        addedById: ids.alice,
      },
      {
        id: ids.privateItem,
        listId: ids.alicePrivateList,
        name: "Private item",
        position: 1,
        addedById: ids.alice,
      },
      {
        id: ids.bobItem,
        listId: ids.bobList,
        name: "Bob item",
        position: 1,
        addedById: ids.bob,
      },
      {
        id: ids.malloryItem,
        listId: ids.malloryList,
        name: "Mallory item",
        position: 1,
        addedById: ids.mallory,
      },
    ],
  });
  await enforcementAdminPrisma.attachment.createMany({
    data: [
      {
        id: ids.sharedAttachment,
        key: "rls/shared.png",
        name: "shared.png",
        type: "IMAGE",
        contentType: "image/png",
        size: 10,
        listId: ids.aliceSharedList,
        uploadedById: ids.alice,
      },
      {
        id: ids.privateAttachment,
        key: "rls/private.png",
        name: "private.png",
        type: "IMAGE",
        contentType: "image/png",
        size: 10,
        listId: ids.alicePrivateList,
        uploadedById: ids.alice,
      },
      {
        id: ids.bobAttachment,
        key: "rls/bob.png",
        name: "bob.png",
        type: "IMAGE",
        contentType: "image/png",
        size: 10,
        listId: ids.bobList,
        uploadedById: ids.bob,
      },
    ],
  });
  await enforcementAdminPrisma.userDailyUsage.createMany({
    data: [
      { id: "rls_usage_alice", userId: ids.alice, date: new Date("2026-08-21") },
      { id: "rls_usage_bob", userId: ids.bob, date: new Date("2026-08-21") },
      {
        id: "rls_usage_mallory",
        userId: ids.mallory,
        date: new Date("2026-08-21"),
      },
    ],
  });

  return ids;
}

async function setTablesEnforcement(
  tables: readonly string[],
  enabled: boolean,
) {
  for (const table of tables) {
    await enforcementAdminPrisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ${enabled ? "ENABLE" : "DISABLE"} ROW LEVEL SECURITY`,
    );
  }
  for (const table of tables) {
    await enforcementAdminPrisma.$executeRawUnsafe(
      `ALTER TABLE "${table}" ${enabled ? "ENABLE" : "DISABLE"} TRIGGER app_tenant_update_columns_guard`,
    );
  }
}

async function setEnforcement(enabled: boolean) {
  await setTablesEnforcement(TENANT_TABLES, enabled);
}

runtimeDescribe("частичный Preview-профиль RLS List + Item", () => {
  beforeAll(async () => {
    await setTablesEnforcement(LIST_ITEM_PROFILE_TABLES, true);
  });

  afterAll(async () => {
    await setTablesEnforcement(LIST_ITEM_PROFILE_TABLES, false);
  });

  it("фильтрует List/Item, не притворяясь enforcement для остальных таблиц", async () => {
    const ids = await seedFixture();

    const rows = await withSpaceDb(ids.bob, ids.bobSpace, async (tx) => {
      const [lists, items, spaces] = await Promise.all([
        tx.list.findMany({ select: { id: true } }),
        tx.item.findMany({ select: { id: true } }),
        tx.space.findMany({ select: { id: true } }),
      ]);
      return { lists, items, spaces };
    });

    expect(rows.lists.map(({ id }) => id).sort()).toEqual(
      [ids.aliceSharedList, ids.bobList].sort(),
    );
    expect(rows.items.map(({ id }) => id).sort()).toEqual(
      [ids.sharedItem, ids.bobItem].sort(),
    );
    expect(rows.spaces).toHaveLength(4);
  });

  it("создаёт List через настоящий Server Action под включённым RLS", async () => {
    const ids = await seedFixture();

    setSessionUser(ids.bob);
    const result = await createList(
      formData({
        title: "Создано под RLS",
        spaceId: ids.bobSpace,
      }),
    );

    expect(result).toMatchObject({
      success: true,
      list: {
        title: "Создано под RLS",
        ownerId: ids.bob,
        items: [],
      },
    });
    expect(
      await enforcementAdminPrisma.list.findFirst({
        where: {
          title: "Создано под RLS",
          ownerId: ids.bob,
          spaceId: ids.bobSpace,
        },
      }),
    ).not.toBeNull();
  });

  it("сохраняет editor content и owner-only rename через настоящие Server Actions", async () => {
    const ids = await seedFixture();

    setSessionUser(ids.bob);
    expect(
      await addItem(
        formData({
          itemName: "Добавлено редактором",
          listId: ids.aliceSharedList,
          spaceId: ids.bobSpace,
        }),
      ),
    ).toEqual({ success: true });
    expect(
      await renameList(
        formData({
          listId: ids.aliceSharedList,
          title: "Захват редактором",
          spaceId: ids.bobSpace,
        }),
      ),
    ).toEqual({
      success: false,
      error: "Только владелец может переименовать список",
    });

    setSessionUser(ids.alice);
    expect(
      await renameList(
        formData({
          listId: ids.aliceSharedList,
          title: "Новое имя владельца",
          spaceId: ids.aliceSpace,
        }),
      ),
    ).toEqual({ success: true });

    expect(
      await enforcementAdminPrisma.item.findFirst({
        where: {
          listId: ids.aliceSharedList,
          name: "Добавлено редактором",
          addedById: ids.bob,
        },
      }),
    ).not.toBeNull();
    expect(
      await enforcementAdminPrisma.list.findUnique({
        where: { id: ids.aliceSharedList },
        select: { title: true },
      }),
    ).toEqual({ title: "Новое имя владельца" });
  });
});

runtimeDescribe("частичный Preview-профиль RLS Space + Groups", () => {
  beforeAll(async () => {
    await setTablesEnforcement(SPACE_GROUPS_PROFILE_TABLES, true);
  });

  afterAll(async () => {
    await setTablesEnforcement(SPACE_GROUPS_PROFILE_TABLES, false);
  });

  it("фильтрует Space/groups/memberships, оставляя финальные таблицы выключенными", async () => {
    const ids = await seedFixture();

    const rows = await withSpaceDb(ids.bob, ids.bobSpace, async (tx) => {
      const [spaces, groups, memberships, attachments] = await Promise.all([
        tx.space.findMany({ select: { id: true } }),
        tx.listGroup.findMany({ select: { id: true } }),
        tx.listGroupMembership.findMany({
          select: { groupId: true, listId: true },
        }),
        tx.attachment.findMany({ select: { id: true } }),
      ]);
      return { spaces, groups, memberships, attachments };
    });

    expect(rows.spaces.map(({ id }) => id).sort()).toEqual(
      [ids.bobSpace, ids.bobOtherSpace].sort(),
    );
    expect(rows.groups).toEqual([{ id: ids.bobGroup }]);
    expect(rows.memberships).toEqual([
      { groupId: ids.bobGroup, listId: ids.aliceSharedList },
    ]);
    expect(rows.attachments).toHaveLength(3);
  });

  it("создаёт Space, Group и membership через настоящие Server Actions", async () => {
    const ids = await seedFixture();
    setSessionUser(ids.bob);

    expect(await createSpace("Работа под RLS")).toMatchObject({ success: true });
    const groupResult = await createGroup(
      formData({ name: "Группа под RLS", spaceId: ids.bobSpace }),
    );
    expect(groupResult).toMatchObject({
      success: true,
      group: { name: "Группа под RLS" },
    });
    if (!groupResult.success || !groupResult.group) {
      throw new Error("Группа не создана под RLS");
    }
    const groupId = groupResult.group.id;

    expect(
      await renameGroup(
        formData({
          groupId,
          name: "Переименовано под RLS",
          spaceId: ids.bobSpace,
        }),
      ),
    ).toEqual({ success: true });
    expect(
      await addListToGroup(
        formData({
          groupId,
          listId: ids.aliceSharedList,
          spaceId: ids.bobSpace,
        }),
      ),
    ).toEqual({ success: true });

    expect(
      await enforcementAdminPrisma.listGroup.findUnique({
        where: { id: groupId },
        select: { name: true },
      }),
    ).toEqual({ name: "Переименовано под RLS" });
    expect(
      await enforcementAdminPrisma.listGroupMembership.findUnique({
        where: {
          listId_groupId: {
            listId: ids.aliceSharedList,
            groupId,
          },
        },
      }),
    ).not.toBeNull();
  });
});

runtimeDescribe("tenant RLS под restricted runtime-ролью", () => {
  beforeAll(async () => {
    await setEnforcement(true);
  });

  afterAll(async () => {
    await setEnforcement(false);
  });

  it("фильтрует прямые нефильтрованные чтения всех tenant-таблиц", async () => {
    const ids = await seedFixture();

    const rows = await withSpaceDb(ids.bob, ids.bobSpace, async (tx) => {
      const [spaces, lists, shares, groups, memberships, items, attachments, usage] =
        await Promise.all([
          tx.space.findMany({ select: { id: true } }),
          tx.list.findMany({ select: { id: true } }),
          tx.listShare.findMany({ select: { listId: true } }),
          tx.listGroup.findMany({ select: { id: true } }),
          tx.listGroupMembership.findMany({ select: { groupId: true, listId: true } }),
          tx.item.findMany({ select: { id: true } }),
          tx.attachment.findMany({ select: { id: true } }),
          tx.userDailyUsage.findMany({ select: { userId: true } }),
        ]);
      return { spaces, lists, shares, groups, memberships, items, attachments, usage };
    });

    expect(rows.spaces.map(({ id }) => id).sort()).toEqual(
      [ids.bobSpace, ids.bobOtherSpace].sort(),
    );
    expect(rows.lists.map(({ id }) => id).sort()).toEqual(
      [ids.aliceSharedList, ids.bobList].sort(),
    );
    expect(rows.shares).toEqual([{ listId: ids.aliceSharedList }]);
    expect(rows.groups).toEqual([{ id: ids.bobGroup }]);
    expect(rows.memberships).toEqual([
      { groupId: ids.bobGroup, listId: ids.aliceSharedList },
    ]);
    expect(rows.items.map(({ id }) => id).sort()).toEqual(
      [ids.sharedItem, ids.bobItem].sort(),
    );
    expect(rows.attachments.map(({ id }) => id).sort()).toEqual(
      [ids.sharedAttachment, ids.bobAttachment].sort(),
    );
    expect(rows.usage).toEqual([{ userId: ids.bob }]);
  });

  it("не переносит Alice/Bob контекст в пуле размера 1 и fail-closed без GUC", async () => {
    const ids = await seedFixture();

    const bobLists = await withSpaceDb(ids.bob, ids.bobSpace, (tx) =>
      tx.list.findMany({ select: { id: true } }),
    );
    const aliceLists = await withSpaceDb(ids.alice, ids.aliceSpace, (tx) =>
      tx.list.findMany({ select: { id: true } }),
    );

    expect(bobLists.map(({ id }) => id).sort()).toEqual(
      [ids.aliceSharedList, ids.bobList].sort(),
    );
    expect(aliceLists.map(({ id }) => id).sort()).toEqual(
      [ids.alicePrivateList, ids.aliceSharedList].sort(),
    );
    expect(await singleConnectionPrisma.list.findMany()).toEqual([]);
    expect(
      await withUserDb(ids.bob, (tx) => tx.list.findMany()),
    ).toEqual([]);
    await expect(
      singleConnectionPrisma.list.create({
        data: {
          id: "rls_missing_context_list",
          ownerId: ids.bob,
          spaceId: ids.bobSpace,
          title: "Denied",
        },
      }),
    ).rejects.toThrow();
  });

  it("разрешает editor content и перенос между доступными списками, но защищает ownership", async () => {
    const ids = await seedFixture();

    await withSpaceDb(ids.bob, ids.bobSpace, async (tx) => {
      await tx.list.update({
        where: { id: ids.aliceSharedList },
        data: { note: "editor note", noteVersion: { increment: 1 } },
      });
      await tx.item.update({
        where: { id: ids.bobItem },
        data: { listId: ids.aliceSharedList, position: 2 },
      });
      await tx.listGroupMembership.update({
        where: {
          listId_groupId: {
            listId: ids.aliceSharedList,
            groupId: ids.bobGroup,
          },
        },
        data: { position: 2 },
      });
    });

    await expect(
      withSpaceDb(ids.bob, ids.bobSpace, (tx) =>
        tx.list.update({
          where: { id: ids.aliceSharedList },
          data: { title: "Editor takeover" },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSpaceDb(ids.bob, ids.bobSpace, (tx) =>
        tx.list.update({
          where: { id: ids.bobList },
          data: { ownerId: ids.alice, spaceId: ids.aliceSpace },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSpaceDb(ids.bob, ids.bobSpace, (tx) =>
        tx.item.update({
          where: { id: ids.bobItem },
          data: { listId: ids.bobOtherList },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSpaceDb(ids.mallory, ids.mallorySpace, (tx) =>
        tx.item.update({
          where: { id: ids.sharedItem },
          data: { name: "Stranger write" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("закрывает spoofed attribution, share escalation и недопустимый attachment transition", async () => {
    const ids = await seedFixture();

    await withSpaceDb(ids.bob, ids.bobSpace, async (tx) => {
      await tx.item.create({
        data: {
          id: "rls_item_by_bob",
          listId: ids.aliceSharedList,
          name: "By Bob",
          position: 2,
          addedById: ids.bob,
        },
      });
      await tx.attachment.update({
        where: { id: ids.sharedAttachment },
        data: { status: "UPLOADED", size: 20 },
      });
      expect(
        await tx.userDailyUsage.deleteMany({ where: { userId: ids.alice } }),
      ).toEqual({ count: 0 });
      expect(
        await tx.userDailyUsage.deleteMany({ where: { userId: ids.bob } }),
      ).toEqual({ count: 1 });
    });

    await expect(
      withSpaceDb(ids.bob, ids.bobSpace, (tx) =>
        tx.item.create({
          data: {
            id: "rls_item_spoofed",
            listId: ids.aliceSharedList,
            name: "Spoofed",
            position: 3,
            addedById: ids.alice,
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSpaceDb(ids.bob, ids.bobSpace, (tx) =>
        tx.listShare.create({
          data: {
            listId: ids.aliceSharedList,
            userId: ids.mallory,
            spaceId: ids.mallorySpace,
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSpaceDb(ids.bob, ids.bobSpace, (tx) =>
        tx.attachment.update({
          where: { id: ids.bobAttachment },
          data: { status: "UPLOADED", size: 20, name: "tampered.png" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("проводит owner invite/revoke и self-leave через настоящие Server Actions", async () => {
    const ids = await seedFixture();

    setSessionUser(ids.bob);
    expect(
      await shareList(
        formData({
          listId: ids.bobList,
          email: "rls-mallory@test.local",
          spaceId: ids.bobSpace,
        }),
      ),
    ).toMatchObject({
      success: true,
      user: { id: ids.mallory, email: "rls-mallory@test.local" },
    });
    expect(
      await enforcementAdminPrisma.listShare.findUnique({
        where: {
          listId_userId: { listId: ids.bobList, userId: ids.mallory },
        },
      }),
    ).not.toBeNull();

    expect(
      await removeSharedUser(
        formData({
          listId: ids.bobList,
          userId: ids.mallory,
          spaceId: ids.bobSpace,
        }),
      ),
    ).toEqual({ success: true });
    expect(
      await enforcementAdminPrisma.listShare.findUnique({
        where: {
          listId_userId: { listId: ids.bobList, userId: ids.mallory },
        },
      }),
    ).toBeNull();

    expect(
      await leaveSharedList(
        formData({ listId: ids.aliceSharedList, spaceId: ids.bobSpace }),
      ),
    ).toEqual({ success: true });
    expect(
      await enforcementAdminPrisma.listShare.findUnique({
        where: {
          listId_userId: { listId: ids.aliceSharedList, userId: ids.bob },
        },
      }),
    ).toBeNull();
  });

  it("проводит PENDING → UPLOADED → delete через настоящие attachment Actions", async () => {
    const ids = await seedFixture();

    setSessionUser(ids.bob);
    const requested = await requestUpload({
      listId: ids.aliceSharedList,
      spaceId: ids.bobSpace,
      fileName: "rls-upload.png",
      contentType: "image/png",
      size: 100,
    });
    expect(requested).toMatchObject({ success: true });
    if (!requested.success || !requested.upload) {
      throw new Error("PENDING-вложение не создано под tenant-full RLS");
    }

    const { headObject } = await import("@/lib/s3");
    vi.mocked(headObject).mockResolvedValueOnce({
      contentLength: 4096,
      contentType: "image/png",
    });
    expect(
      await confirmUpload({
        attachmentId: requested.upload.attachmentId,
        spaceId: ids.bobSpace,
      }),
    ).toEqual({ success: true });
    expect(
      await enforcementAdminPrisma.attachment.findUnique({
        where: { id: requested.upload.attachmentId },
        select: { status: true, size: true, uploadedById: true },
      }),
    ).toEqual({ status: "UPLOADED", size: 4096, uploadedById: ids.bob });

    setSessionUser(ids.alice);
    expect(
      await deleteAttachment({
        attachmentId: requested.upload.attachmentId,
        spaceId: ids.aliceSpace,
      }),
    ).toEqual({ success: true });
    expect(
      await enforcementAdminPrisma.attachment.findUnique({
        where: { id: requested.upload.attachmentId },
      }),
    ).toBeNull();
  });
});

afterAll(async () => {
  await singleConnectionPrisma.$disconnect();
  await enforcementAdminPrisma.$disconnect();
});
