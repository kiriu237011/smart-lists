/**
 * @file page.tsx
 * @description Корневая страница — недостижима при нормальной работе.
 * proxy.ts автоматически редиректит / на локаль пользователя
 * (кука NEXT_LOCALE → Accept-Language → defaultLocale).
 * Этот компонент — запасной редирект на случай обхода middleware.
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/en");
}
