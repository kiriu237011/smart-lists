import prisma from "@/lib/db";
import { auth, signIn, signOut } from "@/auth";
import { getTranslations } from "next-intl/server";
import ListsContainer from "@/app/components/ListsContainer";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";

/**
 * Главная страница приложения (Server Component).
 * Рендерится для каждой локали: /ru и /vi.
 */
export default async function Home() {
  const session = await auth();
  const t = await getTranslations();

  // -----------------------------------------------------------------------
  // СЦЕНАРИЙ 1: ГОСТЬ (не залогинен)
  // -----------------------------------------------------------------------
  if (!session || !session.user || !session.user.id) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-24">
        <div className="absolute top-4 right-4">
          <LanguageSwitcher />
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold mb-6 sm:mb-8">
          {t("Auth.title")}
        </h1>
        <p className="text-gray-500 mb-8">{t("Auth.subtitle")}</p>

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
      </main>
    );
  }

  // -----------------------------------------------------------------------
  // СЦЕНАРИЙ 2: АВТОРИЗОВАННЫЙ ПОЛЬЗОВАТЕЛЬ
  // -----------------------------------------------------------------------
  const allLists = await prisma.shoppingList.findMany({
    where: {
      OR: [
        { ownerId: session.user.id },
        { sharedWith: { some: { id: session.user.id } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          addedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      owner: true,
      sharedWith: true,
    },
  });

  return (
    <main className="p-4 sm:p-10 max-w-xl mx-auto">
      {/* Шапка */}
      <div className="flex items-center justify-between gap-4 mb-8 p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
        {/* Аватар + имя + email */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 font-semibold text-sm flex items-center justify-center uppercase">
            {(session.user.name ?? session.user.email ?? "?").charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 truncate">
              {t("Home.greeting", { name: session.user.name ?? "" })}
            </p>
            <p className="text-xs text-gray-400 truncate">
              {session.user.email}
            </p>
          </div>
        </div>

        {/* Правая часть: переключатель + разделитель + логаут */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <LanguageSwitcher />

          <div className="w-px h-5 bg-gray-200" />

          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-500 transition-colors cursor-pointer">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
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
              {t("Home.signOut")}
            </button>
          </form>
        </div>
      </div>

      <ListsContainer
        allLists={allLists}
        currentUserId={session.user.id}
        currentUserName={session.user.name ?? null}
        currentUserEmail={session.user.email ?? ""}
      />
    </main>
  );
}
