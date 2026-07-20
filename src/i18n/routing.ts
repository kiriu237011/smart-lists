import { defineRouting } from "next-intl/routing";

/**
 * Конфигурация маршрутизации интернационализации.
 * Чтобы добавить новый язык — достаточно добавить его код в `locales`
 * и создать файл `messages/<код>.json`.
 */
export const routing = defineRouting({
  /** Поддерживаемые локали. */
  locales: ["ru", "vi", "en", "ja"],

  /**
   * Язык по умолчанию — используется, только если язык браузера
   * не удалось сопоставить ни с одной из поддерживаемых локалей.
   */
  defaultLocale: "en",

  /**
   * Автоопределение языка при первом заходе (значение по умолчанию,
   * указано явно как документация поведения):
   *   1. Кука NEXT_LOCALE (выбор пользователя, ставится middleware при переключении).
   *   2. Заголовок Accept-Language браузера.
   *   3. defaultLocale.
   */
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
