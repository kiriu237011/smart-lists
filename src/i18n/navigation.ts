import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Типизированные навигационные утилиты next-intl.
 * Используй эти импорты вместо стандартных next/navigation
 * во всех компонентах, где нужна поддержка локалей.
 *
 * Пример:
 *   import { Link, useRouter, usePathname } from "@/i18n/navigation";
 */
export const { Link, redirect, usePathname, useRouter, permanentRedirect } =
  createNavigation(routing);
