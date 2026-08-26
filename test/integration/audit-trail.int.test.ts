/**
 * @file audit-trail.int.test.ts
 * @description DB foundation append-only audit trail.
 */

import { describe, expect, it } from "vitest";

import { writeAuditEvent } from "@/lib/audit";
import { withSpaceDb } from "@/lib/scoped-db";
import { makeList, makeUser } from "./factories";
import { adminPrisma } from "./setup";

describe("audit trail foundation", () => {
  it("пишет application-event атомарно из scoped-транзакции", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);

    const eventId = await withSpaceDb(
      user.id,
      user.defaultSpaceId,
      (tx) =>
        writeAuditEvent(tx, {
          action: "LIST_DELETED",
          spaceId: user.defaultSpaceId,
          listId: list.id,
        }),
    );

    const event = await adminPrisma.auditEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    expect(event).toMatchObject({
      source: "APPLICATION",
      action: "LIST_DELETED",
      actorUserId: user.id,
      subjectUserId: null,
      spaceId: user.defaultSpaceId,
      listId: list.id,
      targetId: null,
      requestId: null,
    });
    expect(event.databaseRole).not.toBe("");
  });

  it("откатывает audit-event вместе с транзакцией", async () => {
    const user = await makeUser();
    const list = await makeList(user.id, user.defaultSpaceId);

    await expect(
      withSpaceDb(user.id, user.defaultSpaceId, async (tx) => {
        await writeAuditEvent(tx, {
          action: "LIST_AI_ACCESS_CHANGED",
          spaceId: user.defaultSpaceId,
          listId: list.id,
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    await expect(
      adminPrisma.auditEvent.count({
        where: { action: "LIST_AI_ACCESS_CHANGED", listId: list.id },
      }),
    ).resolves.toBe(0);
  });

  it("не принимает чужой space-контекст и административный action", async () => {
    const user = await makeUser();

    await expect(
      withSpaceDb(user.id, user.defaultSpaceId, (tx) =>
        tx.$queryRaw`
          SELECT public.app_write_audit_event(
            'SPACE_DELETED'::public."AuditEventAction",
            'space_other',
            NULL,
            NULL,
            NULL
          )
        `,
      ),
    ).rejects.toThrow();

    await expect(
      withSpaceDb(user.id, user.defaultSpaceId, (tx) =>
        tx.$queryRaw`
          SELECT public.app_write_audit_event(
            'ALLOWED_EMAIL_CREATED'::public."AuditEventAction",
            ${user.defaultSpaceId},
            NULL,
            NULL,
            NULL
          )
        `,
      ),
    ).rejects.toThrow();
  });

  it("фиксирует прямые изменения глобальных admin-таблиц без приватных значений", async () => {
    const email = `audit-${crypto.randomUUID()}@test.local`;
    const privateValue = `private-${crypto.randomUUID()}`;
    const allowed = await adminPrisma.allowedEmail.create({ data: { email } });
    await adminPrisma.allowedEmail.update({
      where: { id: allowed.id },
      data: { email: `updated-${email}` },
    });
    await adminPrisma.allowedEmail.delete({ where: { id: allowed.id } });

    await adminPrisma.appSetting.create({
      data: { key: "auditTestSetting", value: privateValue },
    });
    await adminPrisma.appSetting.update({
      where: { key: "auditTestSetting" },
      data: { value: `updated-${privateValue}` },
    });
    await adminPrisma.appSetting.delete({ where: { key: "auditTestSetting" } });

    const events = await adminPrisma.auditEvent.findMany({
      where: { source: "DATABASE_TRIGGER" },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => event.action)).toEqual([
      "ALLOWED_EMAIL_CREATED",
      "ALLOWED_EMAIL_UPDATED",
      "ALLOWED_EMAIL_DELETED",
      "APP_SETTING_CREATED",
      "APP_SETTING_UPDATED",
      "APP_SETTING_DELETED",
    ]);
    expect(events.slice(0, 3).map((event) => event.targetId)).toEqual([
      allowed.id,
      allowed.id,
      allowed.id,
    ]);
    expect(events.slice(3).map((event) => event.targetId)).toEqual([
      "auditTestSetting",
      "auditTestSetting",
      "auditTestSetting",
    ]);
    expect(events.every((event) => event.actorUserId === null)).toBe(true);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain(privateValue);
  });

  it("удаляет только audit-events старше фиксированных 180 дней", async () => {
    const oldEvent = await adminPrisma.auditEvent.create({
      data: {
        occurredAt: new Date(Date.now() - 181 * 24 * 60 * 60 * 1000),
        source: "DATABASE_TRIGGER",
        action: "APP_SETTING_UPDATED",
        targetId: "old-setting",
        databaseRole: "test-admin",
      },
    });
    const recentEvent = await adminPrisma.auditEvent.create({
      data: {
        occurredAt: new Date(Date.now() - 179 * 24 * 60 * 60 * 1000),
        source: "DATABASE_TRIGGER",
        action: "APP_SETTING_UPDATED",
        targetId: "recent-setting",
        databaseRole: "test-admin",
      },
    });

    const [result] = await adminPrisma.$queryRaw<Array<{ deletedCount: bigint }>>`
      SELECT public.app_prune_audit_events() AS "deletedCount"
    `;

    expect(Number(result.deletedCount)).toBe(1);
    expect(
      await adminPrisma.auditEvent.findMany({
        where: { id: { in: [oldEvent.id, recentEvent.id] } },
        select: { id: true },
      }),
    ).toEqual([{ id: recentEvent.id }]);
  });
});
