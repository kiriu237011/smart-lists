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
 *   - Проверяется членство пользователя в списке (владелец или sharedWith).
 *   - userMessage ограничен 500 символами (защита от cost abuse).
 */

"use server";

import { auth } from "@/auth";
import prisma from "@/lib/db";

/** Максимальная длина пользовательского вопроса (символов). */
const MAX_USER_MESSAGE_LENGTH = 500;

/** Результат запроса к AI-сервису. */
interface InsightResult {
  insight?: string;
  error?: string;
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
): Promise<InsightResult> {
  // Проверяем авторизацию
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  // Получаем данные из БД и одновременно проверяем права доступа.
  // Пользователь должен быть владельцем или участником списка.
  const list = await prisma.list.findFirst({
    where: {
      id: listId,
      OR: [
        { ownerId: session.user.id },
        { sharedWith: { some: { id: session.user.id } } },
      ],
    },
    select: {
      title: true,
      items: { select: { name: true } },
    },
  });

  if (!list) {
    return { error: "Список не найден" };
  }

  const serviceUrl = process.env.INSIGHTS_SERVICE_URL;
  const secret = process.env.INSIGHTS_SERVICE_SECRET;

  if (!serviceUrl || !secret) {
    return { error: "Service not configured" };
  }

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
        title: list.title,
        items: list.items.map((item) => item.name),
        user_message: safeUserMessage ?? null,
      }),
    });

    if (!response.ok) {
      return { error: "Service error" };
    }

    const data = (await response.json()) as { insight: string };
    return { insight: data.insight };
  } catch {
    return { error: "Could not connect to AI service" };
  }
}
