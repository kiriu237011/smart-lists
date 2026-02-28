/**
 * @file auth.ts
 * @description Конфигурация аутентификации на основе библиотеки Auth.js (NextAuth v5).
 *
 * Этот файл — центральное место для всей логики входа/выхода и сессий.
 * Он экспортирует четыре именованных значения, которые используются в разных частях приложения:
 *
 * - `handlers` — объект { GET, POST }, подключаемый в API-роуте `/api/auth/[...nextauth]`.
 *   Обрабатывает все OAuth-колбэки и управление сессиями (cookies и т.д.).
 *
 * - `signIn(provider)` — Server Action/функция для запуска процесса входа.
 *   Принимает название провайдера: `signIn("google")`.
 *
 * - `signOut()` — Server Action/функция для выхода из системы и очистки сессии.
 *
 * - `auth()` — асинхронная функция для получения текущей сессии.
 *   Используется в Server Components и Server Actions.
 *   Возвращает `Session | null`.
 *
 * Провайдер: Google OAuth 2.0.
 * Учётные данные (CLIENT_ID, CLIENT_SECRET) хранятся в `.env.local`.
 *
 * Адаптер: PrismaAdapter — автоматически создаёт/обновляет записи
 * в таблицах `User`, `Account`, `Session`, `VerificationToken` в PostgreSQL.
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  /**
   * Связываем Auth.js с базой данных через Prisma.
   * Адаптер автоматически управляет сессиями и пользователями в БД —
   * не нужно писать SQL-запросы вручную.
   */
  adapter: PrismaAdapter(prisma),

  /**
   * Список провайдеров (способов входа).
   * Здесь используется только Google OAuth.
   * Можно добавить GitHub, Discord, email-ссылку и т.д.
   */
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],

  callbacks: {
    /**
     * Коллбэк `session` вызывается каждый раз при чтении сессии
     * (например, при вызове `auth()` или `useSession()`).
     *
     * Проблема: по умолчанию объект `session.user` содержит только name, email, image.
     * `user.id` (из базы данных) туда не попадает.
     *
     * Решение: вручную добавляем `user.id` из БД (параметр `user`) в объект сессии.
     * Это нужно для Server Actions, где мы проверяем, является ли пользователь
     * владельцем списка: `session.user.id === list.ownerId`.
     *
     * @param session - Текущий объект сессии (без id)
     * @param user - Запись пользователя из базы данных (с id)
     * @returns Обновлённый объект сессии с id
     */
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});
