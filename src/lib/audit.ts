import "server-only";

import type { ScopedTransaction } from "@/lib/scoped-db";

type SpaceAuditEvent = {
  action: "SPACE_DELETED";
  spaceId: string;
};

type ListAuditEvent = {
  action: "LIST_DELETED" | "LIST_AI_ACCESS_CHANGED";
  spaceId: string;
  listId: string;
};

type SharingAuditEvent = {
  action: "LIST_SHARE_GRANTED" | "LIST_SHARE_REVOKED" | "LIST_SHARE_LEFT";
  spaceId: string;
  listId: string;
  subjectUserId: string;
};

type AttachmentAuditEvent = {
  action: "ATTACHMENT_UPLOADED" | "ATTACHMENT_DELETED";
  spaceId: string;
  listId: string;
  targetId: string;
};

export type ApplicationAuditEvent =
  | SpaceAuditEvent
  | ListAuditEvent
  | SharingAuditEvent
  | AttachmentAuditEvent;

/**
 * Атомарно добавляет событие в append-only журнал.
 *
 * Actor берётся самой DB-функцией из transaction-local `app.user_id`, а не
 * из аргумента. Функция также сверяет `spaceId` с `app.space_id` и принимает
 * только application-action из закрытого allowlist.
 */
export async function writeAuditEvent(
  tx: ScopedTransaction,
  event: ApplicationAuditEvent,
): Promise<string> {
  const listId = "listId" in event ? event.listId : null;
  const targetId = "targetId" in event ? event.targetId : null;
  const subjectUserId =
    "subjectUserId" in event ? event.subjectUserId : null;

  const [result] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT public.app_write_audit_event(
      CAST(${event.action} AS public."AuditEventAction"),
      ${event.spaceId},
      ${listId},
      ${targetId},
      ${subjectUserId}
    )::text AS id
  `;

  if (!result?.id) {
    throw new Error("PostgreSQL не вернул ID события аудита.");
  }
  return result.id;
}
