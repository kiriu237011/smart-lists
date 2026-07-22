/**
 * @file insights.ts
 * @description Server Action для получения AI-инсайта по списку.
 *
 * Вызывает FastAPI-сервис, который формирует промпт и обращается к AI API.
 * Авторизация между сервисами — через shared secret (Bearer token).
 *
 * Предусловия:
 *   - Пользователь должен быть авторизован через NextAuth.
 *   - Переменные окружения INSIGHTS_SERVICE_URL и INSIGHTS_SERVICE_SECRET должны быть заданы.
 *
 * Безопасность:
 *   - Данные списка берутся из БД, а не от клиента (защита от подмены данных).
 *   - Проверяется членство пользователя в списке (владелец или ListShare).
 *   - userMessage ограничен 500 символами (защита от cost abuse).
 *   - Rate limiting: не более 15 запросов в день на пользователя (через AiInsightUsage).
 */

"use server";

import { auth } from "@/auth";
import prisma from "@/lib/db";
import { listInSpaceWhere } from "@/lib/spaces";
import { logger, hashId } from "@/lib/logger";
import {
  MAX_INSIGHT_ITEM_NOTES,
  MAX_INSIGHT_ITEM_NOTES_CHARS,
  MAX_INSIGHT_ITEMS,
  MAX_NOTE_LENGTH,
} from "@/lib/notes";

/** Максимальная длина пользовательского вопроса (символов). */
const MAX_USER_MESSAGE_LENGTH = 500;

/** Максимальное количество AI-инсайтов в день на пользователя. */
const DAILY_INSIGHT_LIMIT = 15;

/** Результат запроса к AI-сервису. */
interface InsightResult {
  insight?: string;
  error?: string;
  notesContext?: {
    includedItemNotes: number;
    omittedItemNotes: number;
  };
}

/**
 * Получает AI-инсайт для списка.
 *
 * Данные списка (title, items) запрашиваются из БД по listId —
 * клиент не может передать произвольные данные или получить доступ
 * к чужому списку.
 *
 * @param listId - ID списка (проверяется доступ пользователя).
 * @param userMessage - Необязательный вопрос пользователя к AI (макс. 500 символов).
 */
export async function getListInsight(
  listId: string,
  userMessage?: string,
  spaceId?: string,
): Promise<InsightResult> {
  // Проверяем авторизацию
  const session = await auth();
  if (!session?.user?.id || !spaceId) {
    return { error: "Unauthorized" };
  }

  // Получаем данные из БД и одновременно проверяем права доступа.
  // Пользователь должен быть владельцем или участником списка.
  // Эта проверка идёт ДО rate limiting: запрос на недоступный listId
  // не должен списывать квоту легитимного пользователя.
  const list = await prisma.list.findFirst({
    where: {
      id: listId,
      ...listInSpaceWhere(session.user.id, spaceId),
    },
    select: {
      title: true,
      note: true,
    },
  });

  if (!list) {
    logger.warn({ uid: hashId(session.user.id), listId, action: "getListInsight" }, "Доступ к списку запрещён или список не найден");
    return { error: "Список не найден" };
  }

  // Конфиг сервиса проверяем тоже ДО rate limiting — иначе при отсутствии
  // env-переменных квота списывалась бы впустую.
  const serviceUrl = process.env.INSIGHTS_SERVICE_URL;
  const secret = process.env.INSIGHTS_SERVICE_SECRET;

  if (!serviceUrl || !secret) {
    logger.error({ action: "getListInsight" }, "INSIGHTS_SERVICE_URL или INSIGHTS_SERVICE_SECRET не заданы");
    return { error: "Service not configured" };
  }

  // Заметка списка имеет отдельный гарантированный бюджет. Заметки записей
  // выбираются независимо от первых 50 обычных записей: важная заметка не
  // исчезнет только потому, что её запись находится ниже в длинном списке.
  const [baseItems, noteCandidates, totalItemNotes] = await Promise.all([
    prisma.item.findMany({
      where: { listId },
      orderBy: [{ isCompleted: "asc" }, { createdAt: "asc" }],
      take: MAX_INSIGHT_ITEMS,
      select: { id: true, name: true, isCompleted: true },
    }),
    prisma.item.findMany({
      where: { listId, note: { not: null } },
      orderBy: [
        { isCompleted: "asc" },
        { noteUpdatedAt: "desc" },
        { createdAt: "asc" },
      ],
      take: MAX_INSIGHT_ITEM_NOTES,
      select: { id: true, name: true, isCompleted: true, note: true },
    }),
    prisma.item.count({ where: { listId, note: { not: null } } }),
  ]);

  let itemNotesChars = 0;
  const selectedNoteItems: typeof noteCandidates = [];
  for (const item of noteCandidates) {
    const safeNote = item.note?.slice(0, MAX_NOTE_LENGTH) ?? "";
    if (!safeNote) continue;
    if (itemNotesChars + safeNote.length > MAX_INSIGHT_ITEM_NOTES_CHARS) break;
    itemNotesChars += safeNote.length;
    selectedNoteItems.push({ ...item, note: safeNote });
  }

  const selectedItems = new Map<
    string,
    { id: string; name: string; isCompleted: boolean; note: string | null }
  >();
  for (const item of selectedNoteItems) {
    selectedItems.set(item.id, item);
  }
  for (const item of baseItems) {
    if (selectedItems.size >= MAX_INSIGHT_ITEMS) break;
    if (!selectedItems.has(item.id)) selectedItems.set(item.id, { ...item, note: null });
  }

  const includedItemNotes = selectedNoteItems.length;
  const omittedItemNotes = Math.max(0, totalItemNotes - includedItemNotes);

  // --- Rate limiting ---
  // Нормализуем текущую дату до UTC-полуночи.
  // Единственное место в коде где происходит эта нормализация —
  // Postgres хранит любой timestamp, ограничение исключительно на уровне логики.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Атомарно инкрементируем счётчик: upsert + increment держит row lock
  // на уникальном ключе (userId, date), и параллельные запросы получают
  // строго возрастающие значения count: 1, 2, 3, ...
  // Это закрывает TOCTOU-окно прежней схемы (отдельные findUnique и upsert),
  // через которое Promise.all из N запросов мог проскочить проверку при count=0.
  const usage = await prisma.aiInsightUsage.upsert({
    where: { userId_date: { userId: session.user.id, date: today } },
    update: { count: { increment: 1 } },
    create: { userId: session.user.id, date: today, count: 1 },
    select: { count: true },
  });

  // Если перебрали лимит — откатываем свой инкремент и возвращаем ошибку.
  // Decrement обёрнут в .catch: если он упадёт, счётчик останется завышенным
  // на 1, но на следующий день будет создана новая строка по новому ключу
  // (userId, date) — старая с завышенным count просто перестаёт читаться.
  if (usage.count > DAILY_INSIGHT_LIMIT) {
    await prisma.aiInsightUsage
      .update({
        where: { userId_date: { userId: session.user.id, date: today } },
        data: { count: { decrement: 1 } },
      })
      .catch((err) => {
        logger.error({ error: err }, "AiInsightUsage decrement failed:");
      });
    logger.warn({ uid: hashId(session.user.id), listId, count: usage.count, action: "getListInsight" }, "Превышен дневной лимит AI-инсайтов");
    return { error: "rateLimitError" };
  }
  // --- /Rate limiting ---

  // Hard cap на длину вопроса — защита от cost abuse
  const safeUserMessage = userMessage?.slice(0, MAX_USER_MESSAGE_LENGTH);

  try {
    const response = await fetch(`${serviceUrl}/insights`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        title: list.title.slice(0, 200),
        list_note: list.note?.slice(0, MAX_NOTE_LENGTH) ?? null,
        items: [...selectedItems.values()].map((item) => ({
          name: item.name.slice(0, 200),
          is_completed: item.isCompleted,
          note: item.note,
        })),
        notes_meta: {
          list_note_included: Boolean(list.note),
          included_item_notes: includedItemNotes,
          omitted_item_notes: omittedItemNotes,
        },
        user_message: safeUserMessage ?? null,
      }),
    });

    if (!response.ok) {
      logger.error({ uid: hashId(session.user.id), listId, status: response.status, action: "getListInsight" }, "AI-сервис вернул ошибку");
      return { error: "Service error" };
    }

    const data = (await response.json()) as { insight: string };
    logger.info({ uid: hashId(session.user.id), listId, action: "getListInsight" }, "AI-инсайт получен");
    return {
      insight: data.insight,
      notesContext: { includedItemNotes, omittedItemNotes },
    };
  } catch (error) {
    logger.error({ uid: hashId(session.user.id), listId, error, action: "getListInsight" }, "Ошибка подключения к AI-сервису");
    return { error: "Could not connect to AI service" };
  }
}
