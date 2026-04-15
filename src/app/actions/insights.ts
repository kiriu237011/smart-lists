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
 */

"use server";

import { auth } from "@/auth";

/** Результат запроса к AI-сервису. */
interface InsightResult {
  insight?: string;
  error?: string;
}

/**
 * Получает AI-инсайт для списка.
 *
 * @param title - Название списка.
 * @param items - Записи списка (только имена).
 * @param userMessage - Необязательный вопрос пользователя к AI.
 */
export async function getListInsight(
  title: string,
  items: string[],
  userMessage?: string,
): Promise<InsightResult> {
  // Проверяем авторизацию
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  const serviceUrl = process.env.INSIGHTS_SERVICE_URL;
  const secret = process.env.INSIGHTS_SERVICE_SECRET;

  if (!serviceUrl || !secret) {
    return { error: "Service not configured" };
  }

  try {
    const response = await fetch(`${serviceUrl}/insights`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        title,
        items,
        user_message: userMessage ?? null,
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
