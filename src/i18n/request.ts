import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

/**
 * Серверная конфигурация next-intl.
 * Вызывается один раз на каждый серверный запрос.
 * Загружает нужный JSON-файл переводов на основе локали из URL.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Если локаль не определена или не поддерживается — откатываемся на дефолтную
  if (
    !locale ||
    !routing.locales.includes(locale as (typeof routing.locales)[number])
  ) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
