import "server-only";

import type { ScopedTransaction } from "@/lib/scoped-db";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TOKENS_PER_CALL = 1000;

export interface AttachmentCleanupItem {
  token: string;
  key: string;
}

interface PrepareRow {
  cleanupPayload: unknown;
  userCount: bigint;
}

/**
 * Проверяет узкий JSON-контракт SECURITY DEFINER-функции. Даже ответ БД не
 * превращаем в S3-команду без проверки формы и UUID-токена.
 */
export function parseAttachmentMaintenanceRow(
  row: PrepareRow | undefined,
): { cleanupItems: AttachmentCleanupItem[]; userCount: number } {
  if (
    !row ||
    typeof row.userCount !== "bigint" ||
    row.userCount < 0n ||
    row.userCount > BigInt(Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(row.cleanupPayload)
  ) {
    throw new Error("Некорректный ответ attachment maintenance helper.");
  }

  const cleanupItems = row.cleanupPayload.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("token" in item) ||
      !("key" in item) ||
      typeof item.token !== "string" ||
      !UUID_PATTERN.test(item.token) ||
      typeof item.key !== "string" ||
      item.key.length === 0
    ) {
      throw new Error("Некорректный cleanup payload attachment helper.");
    }
    return { token: item.token, key: item.key };
  });

  return {
    cleanupItems,
    userCount: Number(row.userCount),
  };
}

export async function prepareAttachmentMaintenance(
  tx: ScopedTransaction,
  listId: string,
): Promise<{ cleanupItems: AttachmentCleanupItem[]; userCount: number }> {
  const [row] = await tx.$queryRaw<PrepareRow[]>`
    SELECT *
    FROM public.app_attachment_prepare_maintenance(${listId})
  `;
  return parseAttachmentMaintenanceRow(row);
}

export async function finishAttachmentMaintenance(
  tx: ScopedTransaction,
  tokens: string[],
  restore: boolean,
): Promise<number> {
  let affected = 0;

  for (let offset = 0; offset < tokens.length; offset += MAX_TOKENS_PER_CALL) {
    const chunk = tokens.slice(offset, offset + MAX_TOKENS_PER_CALL);
    const [row] = await tx.$queryRaw<Array<{ affected: number }>>`
      SELECT public.app_attachment_finish_maintenance(
        ${chunk}::uuid[],
        ${restore}
      ) AS affected
    `;
    if (!row || !Number.isInteger(row.affected) || row.affected < 0) {
      throw new Error("Некорректный результат attachment maintenance helper.");
    }
    affected += row.affected;
  }

  return affected;
}
