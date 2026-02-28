import { defineRouting } from "next-intl/routing";

/**
 * Конфигурация маршрутизации интернационализации.
 * Чтобы добавить новый язык — достаточно добавить его код в `locales`
 * и создать файл `messages/<код>.json`.
 */
export const routing = defineRouting({
  /** Поддерживаемые локали. */
  locales: ["ru", "vi"],

  /** Язык по умолчанию (при заходе на `/` — редирект на `/ru`). */
  defaultLocale: "ru",
});

export type Locale = (typeof routing.locales)[number];
