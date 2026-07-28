import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { GUEST_COOKIE, isGuestModeEnabled } from "@/lib/app-settings";
import { enterGuestMode } from "@/app/actions/guest";
import GuestHome from "@/components/guest/GuestHome";
import { getTranslations } from "next-intl/server";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";
import AuthListPreview from "@/components/auth/AuthListPreview";
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
      <main className="relative min-h-screen overflow-hidden bg-neutral-50 dark:bg-zinc-950">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -left-48 top-1/4 h-96 w-96 rounded-full bg-indigo-200/35 blur-3xl dark:bg-indigo-950/25" />
          <div className="absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-950/20" />
          <div className="absolute bottom-0 right-1/3 h-64 w-64 rounded-full bg-violet-200/25 blur-3xl dark:bg-violet-950/15" />
        </div>

        <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 sm:px-8 lg:px-12">
          <header className="flex h-20 shrink-0 items-center justify-between sm:h-24">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-950 text-white shadow-sm dark:bg-white dark:text-zinc-950">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                  <path
                    d="m6.5 7.5 1.6 1.6 2.6-3M6.5 14.5l1.6 1.6 2.6-3M13 8h4.5M13 15h4.5"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                  />
                </svg>
              </span>
              <span className="text-base font-bold tracking-tight text-gray-950 dark:text-white">
                {t("Auth.title")}
              </span>
            </div>
            <LanguageSwitcher />
          </header>

          <section className="grid flex-1 items-center gap-14 py-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-20 lg:py-16">
            <div className="mx-auto w-full max-w-xl text-center lg:mx-0 lg:text-left">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/70 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm backdrop-blur-sm dark:border-indigo-900/60 dark:bg-indigo-950/30 dark:text-indigo-300">
                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                {t("Auth.eyebrow")}
              </div>
              <h1
                data-testid="auth-hero-title"
                className="text-balance text-4xl font-bold leading-[1.08] tracking-[-0.04em] text-gray-950 sm:text-5xl lg:text-6xl dark:text-white"
              >
                {t("Auth.headline")}
              </h1>
              <p className="mx-auto mt-6 max-w-lg text-base leading-7 text-gray-600 sm:text-lg lg:mx-0 dark:text-zinc-400">
                {t("Auth.subtitle")}
              </p>

              <div className="mx-auto mt-8 max-w-sm lg:mx-0">
                <form
                  action={async () => {
                    "use server";
                    await signIn("google");
                  }}
                >
                  <button
                    data-testid="sign-in-google"
                    className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl bg-blue-600 px-6 py-3.5 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 hover:shadow-blue-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:ring-offset-zinc-950"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    {t("Auth.signIn")}
                  </button>
                </form>

                {/* Гостевой вход — только если разрешён настройкой в БД */}
                {guestModeEnabled && (
                  <div className="mt-3">
                    <form
                      action={async () => {
                        "use server";
                        await enterGuestMode();
                      }}
                    >
                      <button
                        data-testid="sign-in-guest"
                        className="w-full cursor-pointer rounded-xl border border-gray-200 bg-white/60 px-6 py-3.5 font-semibold text-gray-700 backdrop-blur-sm transition hover:border-gray-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:ring-offset-zinc-950"
                      >
                        {t("Auth.guestSignIn")}
                      </button>
                    </form>
                    <p className="mt-3 text-center text-xs leading-5 text-gray-400 dark:text-zinc-500">
                      {t("Auth.guestHint")}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <AuthListPreview
              title={t("Auth.previewTitle")}
              progress={t("Auth.previewProgress", { done: 2, total: 4 })}
              shared={t("Auth.previewShared")}
              items={[
                t("Auth.previewItems.milk"),
                t("Auth.previewItems.vegetables"),
                t("Auth.previewItems.coffee"),
                t("Auth.previewItems.bread"),
              ]}
              note={t("Auth.previewNote")}
            />
          </section>
        </div>
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
