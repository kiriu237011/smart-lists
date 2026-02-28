/**
 * @file page.tsx
 * @description Корневая страница — недостижима при нормальной работе.
 * middleware.ts автоматически редиректит / → /ru (defaultLocale).
 * Этот компонент — запасной редирект на случай обхода middleware.
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/ru");
}
