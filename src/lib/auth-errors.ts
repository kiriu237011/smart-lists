import "server-only";

import { hashId } from "@/lib/logger";

export type AuthErrorContent = {
  title: string;
  description: string;
  hint: string;
};

const ACCESS_DENIED_CONTENT: AuthErrorContent = {
  title: "Доступ закрыт",
  description: "Ваш аккаунт не добавлен в список разрешённых пользователей.",
  hint: "Обратитесь к администратору, чтобы получить доступ.",
};

const GENERIC_AUTH_ERROR_CONTENT: AuthErrorContent = {
  title: "Не удалось войти",
  description: "Во время авторизации произошла ошибка.",
  hint: "Попробуйте ещё раз позже или обратитесь к администратору.",
};

/**
 * Возвращает безопасный текст для публичной страницы ошибки.
 *
 * Только AccessDenied однозначно означает отказ по whitelist. Остальные коды
 * намеренно объединены: OAuth-провайдер и конфигурация диагностируются по
 * серверным логам, а не через детали в браузере пользователя.
 */
export function getAuthErrorContent(
  error: string | string[] | undefined,
): AuthErrorContent {
  const errorCode = Array.isArray(error) ? error[0] : error;

  return errorCode === "AccessDenied"
    ? ACCESS_DENIED_CONTENT
    : GENERIC_AUTH_ERROR_CONTENT;
}

/**
 * Формирует контекст отказа без исходного email.
 *
 * Хеш оставляет возможность связать повторные попытки в логах, но не
 * публикует пользовательский идентификатор.
 */
export function deniedSignInLogContext(email: string) {
  return {
    action: "signIn.denied",
    emailHash: hashId(email),
  } as const;
}
