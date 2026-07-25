/**
 * @file GuestHome.tsx
 * @description Главная страница гостевого режима (вход без аккаунта).
 *
 * Client Component (`"use client"`).
 *
 * Гостевой аналог «Сценария 2» из `page.tsx`: та же шапка и тот же
 * `ListsContainer`, но данные загружаются не из БД, а из localStorage
 * (см. `src/lib/guest-storage.ts`). Компонентам различие не видно —
 * они работают через адаптер `ListsApi` (гостевая реализация).
 *
 * Особенности гостевого режима:
 *   - шаринг, AI-инсайты и вложения скрыты (требуют аккаунта/сервера);
 *   - realtime (Pusher) не подключается;
 *   - данные существуют только в этом браузере.
 *
 * Гидрация: localStorage доступен только на клиенте, поэтому до маунта
 * рендерится скелетон (`ListsSkeleton`) — серверный и клиентский HTML совпадают.
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";
import HeaderSettings from "@/components/layout/HeaderSettings";
import SettingsToggles from "@/components/ui/SettingsToggles";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import ListsContainer from "@/components/lists/ListsContainer";
import ListsSkeleton from "@/components/lists/ListsSkeleton";
import { ListsApiProvider } from "@/components/providers/ListsApiProvider";
import {
  GUEST_USER_ID,
  createGuestListsApi,
  loadGuestData,
  toListData,
  type GuestData,
} from "@/lib/guest-storage";
import { exitGuestMode } from "@/app/actions/guest";

/** Иконка выхода — та же, что у кнопки «Выйти» авторизованного пользователя. */
function SignOutIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function GuestHome() {
  const t = useTranslations();

  /** Гостевые данные. null — до маунта (localStorage ещё не прочитан). */
  const [data, setData] = useState<GuestData | null>(null);

  // Загружаем данные только после гидрации — на сервере localStorage нет.
  // Однократный setState после маунта — осознанный паттерн гидрации:
  // серверный HTML (скелетон) должен совпасть с первым клиентским рендером.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(loadGuestData());
  }, []);

  /** Гостевой аналог revalidatePath: перечитывает localStorage в состояние. */
  const refresh = useCallback(() => {
    setData(loadGuestData());
  }, []);

  const guestName = t("Guest.name");

  // Адаптер стабилен, пока не меняется локаль (guestName)
  const api = useMemo(() => createGuestListsApi(refresh, guestName), [refresh, guestName]);

  // Преобразуем хранимые данные в формат ListData для ListsContainer
  const lists = useMemo(
    () => (data ? toListData(data, guestName) : []),
    [data, guestName],
  );

  const listsCount = lists.length;

  return (
    <main className="p-4 sm:p-10 max-w-7xl mx-auto" data-testid="guest-home">
      {/* Шапка — та же структура, что у авторизованного пользователя */}
      <div className="flex items-center justify-between gap-3 sm:gap-4 mb-8 p-3 sm:p-5 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-700 rounded-2xl shadow-sm dark:shadow-md dark:shadow-black/40">
        {/* Аватар гостя + имя + пояснение */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Статичный серый кружок вместо AvatarButton: у гостя нет email */}
          <div
            aria-hidden
            className="flex-shrink-0 w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 flex items-center justify-center"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-4 h-4 sm:w-6 sm:h-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-gray-800 dark:text-zinc-100 truncate">
              {guestName}
            </p>
            <p className="text-sm text-gray-400 dark:text-zinc-400 truncate">
              {t("Guest.hint")}
            </p>
          </div>
        </div>

        {/* Правая часть: элементы управления */}
        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <div className="flex flex-col items-center flex-shrink-0">
            <span className="text-xl font-bold text-gray-800 dark:text-zinc-100 leading-none">
              {listsCount}
            </span>
            <span className="text-xs text-gray-400 mt-0.5">
              {t("Home.listsLabel", { count: listsCount })}
            </span>
          </div>

          {/* Десктопная версия (растянутые кнопки) */}
          <div className="hidden sm:flex items-center gap-4">
            <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700" />
            <ThemeToggle />
            <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700" />
            <LanguageSwitcher />
            <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700" />
            <HeaderSettings testId="settings-trigger-desktop">
              <SettingsToggles />
            </HeaderSettings>
            <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700" />
            <form action={exitGuestMode}>
              <button
                data-testid="guest-exit"
                className="flex items-center gap-2 text-base text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
              >
                <SignOutIcon />
                <span>{t("Guest.exit")}</span>
              </button>
            </form>
          </div>

          {/* Мобильная версия меню (под шестерёнкой) */}
          <div className="sm:hidden flex items-center">
            <div className="w-px h-5 bg-gray-200 dark:bg-zinc-800 mr-2" />
            <HeaderSettings testId="settings-trigger-mobile">
              <div className="flex justify-center items-center gap-6 mb-5">
                <ThemeToggle />
                <div className="w-px h-6 bg-gray-200 dark:bg-zinc-700" />
                <LanguageSwitcher />
              </div>
              <div className="h-px bg-gray-100 dark:bg-zinc-800 mb-4" />
              <SettingsToggles />
              <div className="h-px bg-gray-100 dark:bg-zinc-800 my-4" />
              <form action={exitGuestMode}>
                <button className="flex items-center gap-3 text-base text-red-500 hover:text-red-600 transition font-medium w-full">
                  <SignOutIcon />
                  {t("Guest.exit")}
                </button>
              </form>
            </HeaderSettings>
          </div>
        </div>
      </div>

      {/* Списки: до чтения localStorage показываем скелетон */}
      {data === null ? (
        <ListsSkeleton />
      ) : (
        <ListsApiProvider api={api}>
          <ListsContainer
            allLists={lists}
            currentUserId={GUEST_USER_ID}
            currentUserName={guestName}
            currentUserEmail=""
            userGroups={data.groups}
          />
        </ListsApiProvider>
      )}
    </main>
  );
}
