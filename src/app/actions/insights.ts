/**
 * @file insights.ts
 * @description Server Action для получения AI-инсайта по списку.
 *
 * Вызывает FastAPI-сервис, который формирует промпт и обращается к AI API.
 * Авторизация между сервисами — Google ID-токен, выпущенный через Workload
 * Identity Federation. Его проверяют дважды и независимо: Cloud Run до того,
 * как запрос дойдёт до сервиса, и сам сервис — по подписи, audience и email
 * вызывающего. Статических секретов на этом пути нет.
 *
 * Предусловия:
 *   - Пользователь должен быть авторизован через NextAuth.
 *   - Переменные окружения INSIGHTS_SERVICE_URL и INSIGHTS_SERVICE_SECRET должны быть заданы.
 *
 * Безопасность:
 *   - Данные списка берутся из БД, а не от клиента (защита от подмены данных).
 *   - Проверяется членство пользователя в списке (владелец или ListShare).
 *   - userMessage ограничен 500 символами (защита от cost abuse).
 *   - Rate limiting: не более 15 запросов в день на пользователя (через UserDailyUsage).
 *   - Вызов сервиса подписан ID-токеном; без него запрос не отправляется вовсе.
 */

"use server";

import { auth } from "@/auth";
import prisma from "@/lib/db";
import { listInSpaceWhere } from "@/lib/spaces";
import { getCloudRunIdToken } from "@/lib/gcp-auth";
import { logger, hashId } from "@/lib/logger";
import {
  MAX_INSIGHT_ITEM_NOTES,
  MAX_INSIGHT_ITEM_NOTES_CHARS,
  MAX_INSIGHT_ITEMS,
  MAX_INSIGHT_SUB_ITEMS,
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
      aiEnabled: true,
    },
  });

  if (!list) {
    logger.warn({ uid: hashId(session.user.id), listId, action: "getListInsight" }, "Доступ к списку запрещён или список не найден");
    return { error: "Список не найден" };
  }

  // Проверка на сервере, а не только скрытая кнопка в интерфейсе. Флаг
  // защищает данные участников списка, поэтому обойти его прямым вызовом
  // Action не должно быть возможно. Отказ идёт до расхода квоты: запрет —
  // не ошибка пользователя.
  if (!list.aiEnabled) {
    logger.info(
      { uid: hashId(session.user.id), listId, action: "getListInsight" },
      "AI выключен для списка",
    );
    return { error: "aiDisabled" };
  }

  // Конфиг сервиса проверяем тоже ДО rate limiting — иначе при отсутствии
  // env-переменных квота списывалась бы впустую.
  const serviceUrl = process.env.INSIGHTS_SERVICE_URL;

  if (!serviceUrl) {
    logger.error({ action: "getListInsight" }, "INSIGHTS_SERVICE_URL не задан");
    return { error: "Service not configured" };
  }

  // Заметка списка имеет отдельный гарантированный бюджет. Заметки записей
  // выбираются независимо от первых 50 обычных записей: важная заметка не
  // исчезнет только потому, что её запись находится ниже в длинном списке.
  //
  // Пункты и подпункты выбираются раздельно. Общая выборка «первые 50 записей»
  // после появления подпунктов означала бы разное для разных списков: один
  // длинный блок вытеснил бы из контекста половину списка.
  const [topLevelItems, subItemRows, noteCandidates, totalItemNotes] =
    await Promise.all([
      prisma.item.findMany({
        where: { listId, parentId: null },
        // Тот же порядок, что видит пользователь: невыполненные сверху,
        // внутри группы — по позиции.
        orderBy: [{ isCompleted: "asc" }, { position: "asc" }, { createdAt: "asc" }],
        take: MAX_INSIGHT_ITEMS,
        select: { id: true, name: true, isCompleted: true },
      }),
      prisma.item.findMany({
        where: { listId, parentId: { not: null } },
        // Позиции сравнимы только внутри своего родителя, поэтому общая
        // сортировка задаёт не глобальный порядок, а лишь то, какие подпункты
        // попадут в бюджет: сначала невыполненные и стоящие выше у себя в
        // блоке. Внутри каждого родителя порядок при этом верен.
        orderBy: [{ isCompleted: "asc" }, { position: "asc" }, { createdAt: "asc" }],
        take: MAX_INSIGHT_SUB_ITEMS,
        select: { id: true, name: true, isCompleted: true, parentId: true },
      }),
      prisma.item.findMany({
        where: { listId, note: { not: null } },
        orderBy: [
          { isCompleted: "asc" },
          { noteUpdatedAt: "desc" },
          { position: "asc" },
          { createdAt: "asc" },
        ],
        take: MAX_INSIGHT_ITEM_NOTES,
        select: {
          id: true,
          name: true,
          isCompleted: true,
          note: true,
          parentId: true,
        },
      }),
      prisma.item.count({ where: { listId, note: { not: null } } }),
    ]);

  // Символьный бюджет заметок общий на оба уровня: для модели заметка
  // подпункта ничем не отличается от заметки пункта.
  let itemNotesChars = 0;
  const noteByItemId = new Map<string, string>();
  for (const item of noteCandidates) {
    const safeNote = item.note?.slice(0, MAX_NOTE_LENGTH) ?? "";
    if (!safeNote) continue;
    if (itemNotesChars + safeNote.length > MAX_INSIGHT_ITEM_NOTES_CHARS) break;
    itemNotesChars += safeNote.length;
    noteByItemId.set(item.id, safeNote);
  }

  // Пункты с заметками идут первыми — тот же приоритет, что и раньше.
  const selectedItems = new Map<
    string,
    { id: string; name: string; isCompleted: boolean }
  >();
  for (const item of noteCandidates) {
    if (item.parentId !== null || !noteByItemId.has(item.id)) continue;
    if (selectedItems.size >= MAX_INSIGHT_ITEMS) break;
    selectedItems.set(item.id, {
      id: item.id,
      name: item.name,
      isCompleted: item.isCompleted,
    });
  }
  for (const item of topLevelItems) {
    if (selectedItems.size >= MAX_INSIGHT_ITEMS) break;
    if (!selectedItems.has(item.id)) selectedItems.set(item.id, item);
  }

  // Подпункт попадает в контекст только вместе со своим пунктом: сам по себе
  // он бессмысленнен, а «Купить продукты» без «Приготовить ужин» ещё и
  // вводит модель в заблуждение.
  const subItemsByParent = new Map<string, typeof subItemRows>();
  for (const subItem of subItemRows) {
    if (!subItem.parentId || !selectedItems.has(subItem.parentId)) continue;
    const siblings = subItemsByParent.get(subItem.parentId);
    if (siblings) {
      siblings.push(subItem);
    } else {
      subItemsByParent.set(subItem.parentId, [subItem]);
    }
  }

  const contextItems = [...selectedItems.values()].map((item) => {
    const subItems = subItemsByParent.get(item.id) ?? [];
    return {
      name: item.name.slice(0, 200),
      // Отметка пункта с подпунктами производная — см. `src/lib/item-tree.ts`.
      // Считается по подпунктам, а не по полю строки: в контексте для модели
      // денормализованному кешу доверять незачем.
      is_completed:
        subItems.length > 0
          ? subItems.every((subItem) => subItem.isCompleted)
          : item.isCompleted,
      note: noteByItemId.get(item.id) ?? null,
      sub_items: subItems.map((subItem) => ({
        name: subItem.name.slice(0, 200),
        is_completed: subItem.isCompleted,
        note: noteByItemId.get(subItem.id) ?? null,
      })),
    };
  });

  // Считаем ровно те заметки, что действительно уехали: заметка подпункта,
  // чей пункт не попал в контекст, в бюджет вошла, а в запрос — нет.
  const includedItemNotes = contextItems.reduce(
    (total, item) =>
      total +
      (item.note ? 1 : 0) +
      item.sub_items.filter((subItem) => subItem.note).length,
    0,
  );
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
  const usage = await prisma.userDailyUsage.upsert({
    where: { userId_date: { userId: session.user.id, date: today } },
    update: { insights: { increment: 1 } },
    create: { userId: session.user.id, date: today, insights: 1 },
    select: { insights: true },
  });

  // Если перебрали лимит — откатываем свой инкремент и возвращаем ошибку.
  // Decrement обёрнут в .catch: если он упадёт, счётчик останется завышенным
  // на 1, но на следующий день будет создана новая строка по новому ключу
  // (userId, date) — старая с завышенным count просто перестаёт читаться.
  if (usage.insights > DAILY_INSIGHT_LIMIT) {
    await prisma.userDailyUsage
      .update({
        where: { userId_date: { userId: session.user.id, date: today } },
        data: { insights: { decrement: 1 } },
      })
      .catch((err) => {
        logger.error({ error: err }, "UserDailyUsage decrement failed:");
      });
    logger.warn({ uid: hashId(session.user.id), listId, count: usage.insights, action: "getListInsight" }, "Превышен дневной лимит AI-инсайтов");
    return { error: "rateLimitError" };
  }
  // --- /Rate limiting ---

  // Hard cap на длину вопроса — защита от cost abuse
  const safeUserMessage = userMessage?.slice(0, MAX_USER_MESSAGE_LENGTH);

  // Токен едет в обычном `Authorization`, а не в `X-Serverless-Authorization`,
  // и это осознанно. Cloud Run принимает оба, но из второго вырезает подпись
  // перед передачей в контейнер — сервис увидел бы claims, которые не может
  // проверить. Из `Authorization` токен доходит целым, поэтому сервис проверяет
  // подпись сам и получается два независимых слоя: платформа отвечает на вопрос
  // «можно ли звать», сервис — «кто именно позвал».
  //
  // Статического секрета здесь больше нет: он был третьим ответом на тот же
  // вопрос, только неизменным годами и хранимым в двух местах сразу.
  const idToken = await getCloudRunIdToken(serviceUrl);

  if (!idToken) {
    // Без токена запрос гарантированно получит отказ от Cloud Run. Отвечаем
    // сразу и понятной ошибкой, а не ждём 403 из сети: рвётся федерация, а не
    // сервис, и в логе должно быть видно именно это.
    logger.error(
      { uid: hashId(session.user.id), action: "getListInsight" },
      "ID-токен Cloud Run не получен — запрос не отправлен",
    );
    return { error: "Service not configured" };
  }

  try {
    const response = await fetch(`${serviceUrl}/insights`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        title: list.title.slice(0, 200),
        list_note: list.note?.slice(0, MAX_NOTE_LENGTH) ?? null,
        // `items` сохраняет прежний смысл — записи верхнего уровня, — поэтому
        // сервис, ничего не знающий о подпунктах, продолжает работать как
        // работал: он просто не увидит поле `sub_items`.
        items: contextItems,
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
