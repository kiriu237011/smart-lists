/**
 * @file route.ts
 * @description Catch-all API Route для Auth.js.
 *
 * Next.js App Router требует наличия файла с HTTP-обработчиками в папке
 * `/api/auth/[...nextauth]/`. Этот файл перехватывает ВСЕ запросы вида:
 *   GET  /api/auth/signin
 *   GET  /api/auth/signout
 *   GET  /api/auth/callback/google   ← Google редиректит сюда после входа
 *   GET  /api/auth/session
 *   ...и другие внутренние маршруты Auth.js
 *
 * Всю логику обработки реализует Auth.js через объект `handlers`,
 * который настроен в `@/auth.ts`. Здесь мы просто реэкспортируем
 * готовые обработчики GET и POST.
 */

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
