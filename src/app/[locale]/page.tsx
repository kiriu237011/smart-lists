import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { GUEST_COOKIE, isGuestModeEnabled } from "@/lib/app-settings";
import { enterGuestMode } from "@/app/actions/guest";
import GuestHome from "@/components/guest/GuestHome";
import { getTranslations } from "next-intl/server";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";
import { ensureSpaceState, getUserSpace, LAST_SPACE_COOKIE } from "@/lib/spaces";
/**
 * Главная страница приложения (Server Component).
 * Рендерится для каждой локали: /ru, /vi, /en, /ja.
 */
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // auth() и getTranslations() независимы — выполняем параллельно.
  // Страница ре-рендерится при каждом Server Action (revalidatePath),
  // поэтому каждый последовательный await здесь удлиняет все действия.
  const [session, t] = await Promise.all([auth(), getTranslations()]);

  // -----------------------------------------------------------------------
  // СЦЕНАРИЙ 1: НЕ ЗАЛОГИНЕН (экран входа или гостевой режим)
  // -----------------------------------------------------------------------
  if (!session || !session.user || !session.user.id) {
    // Флаг из БД и cookie гостя нужны только на этой ветке —
    // авторизованные пользователи лишний запрос к БД не платят
    const [guestModeEnabled, cookieStore] = await Promise.all([
      isGuestModeEnabled(),
      cookies(),
    ]);

    // Гость с cookie-флагом — показываем гостевую версию приложения.
    // Если гостевой режим выключили в БД, ветка не сработает и гость
    // увидит обычный экран входа (данные в его localStorage сохранятся).
    if (guestModeEnabled && cookieStore.get(GUEST_COOKIE)?.value === "1") {
      return <GuestHome />;
    }

    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-24">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold mb-6 sm:mb-8 dark:text-white">
          {t("Auth.title")}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">{t("Auth.subtitle")}</p>

        <form
          action={async () => {
            "use server";
            await signIn("google");
          }}
        >
          <button className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition shadow-lg flex items-center gap-2">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#FFFFFF"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#FFFFFF"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FFFFFF"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#FFFFFF"
              />
            </svg>
            {t("Auth.signIn")}
          </button>
        </form>

        {/* Гостевой вход — только если разрешён настройкой в БД */}
        {guestModeEnabled && (
          <div className="mt-6 flex flex-col items-center gap-2">
            <form
              action={async () => {
                "use server";
                await enterGuestMode();
              }}
            >
              <button className="px-6 py-3 rounded-lg font-semibold border border-gray-300 dark:border-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition cursor-pointer">
                {t("Auth.guestSignIn")}
              </button>
            </form>
            <p className="text-xs text-gray-400 dark:text-zinc-500">
              {t("Auth.guestHint")}
            </p>
          </div>
        )}
      </main>
    );
  }

  // Авторизованная главная — только точка входа в последнее пространство.
  const [{ locale }, cookieStore, defaultSpaceId] = await Promise.all([
    params,
    cookies(),
    ensureSpaceState(session.user.id),
  ]);
  const rememberedId = cookieStore.get(LAST_SPACE_COOKIE)?.value;
  const rememberedSpace = rememberedId
    ? await getUserSpace(session.user.id, rememberedId)
    : null;
  redirect(`/${locale}/spaces/${rememberedSpace?.id ?? defaultSpaceId}`);
}
