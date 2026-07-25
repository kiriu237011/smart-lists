import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { LogOut } from "lucide-react";
import prisma from "@/lib/db";
import { signOut } from "@/auth";
import { listInSpaceWhere } from "@/lib/spaces";
import AvatarButton from "@/components/ui/AvatarButton";
import LanguageSwitcher from "@/components/layout/LanguageSwitcher";
import ListsDataFetcher from "@/components/lists/ListsDataFetcher";
import ListsSkeleton from "@/components/lists/ListsSkeleton";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import HeaderSettings from "@/components/layout/HeaderSettings";
import SettingsToggles from "@/components/ui/SettingsToggles";
import SpaceSwitcher from "@/components/spaces/SpaceSwitcher";
import { SpaceProvider } from "@/components/spaces/SpaceContext";

export default async function AuthenticatedHome({
  userId,
  userName,
  userEmail,
  spaceId,
}: {
  userId: string;
  userName: string | null;
  userEmail: string;
  spaceId: string;
}) {
  const [t, spaces, listsCount] = await Promise.all([
    getTranslations(),
    prisma.space.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true, name: true, isDefault: true },
    }),
    prisma.list.count({ where: listInSpaceWhere(userId, spaceId) }),
  ]);

  return (
    <main className="p-4 sm:p-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 sm:gap-4 mb-5 p-3 sm:p-5 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-700 rounded-2xl shadow-sm dark:shadow-md dark:shadow-black/40">
        <div className="flex items-center gap-3 min-w-0">
          <AvatarButton initial={(userName ?? userEmail ?? "?").charAt(0)} email={userEmail} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-gray-800 dark:text-zinc-100 truncate">
              {t("Home.greeting", { name: userName ?? userEmail })}
            </p>
            <p className="text-sm text-gray-400 dark:text-zinc-400 truncate">{userEmail}</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 items-center gap-4 px-2 xl:flex">
          <div className="h-8 w-px shrink-0 bg-gray-200 dark:bg-zinc-700" />
          <SpaceSwitcher
            spaces={spaces}
            currentSpaceId={spaceId}
            variant="header"
            rememberCurrentSpace={false}
          />
        </div>

        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <div className="flex flex-col items-center flex-shrink-0">
            <span className="text-xl font-bold text-gray-800 dark:text-zinc-100 leading-none">
              {listsCount}
            </span>
            <span className="text-xs text-gray-400 mt-0.5">
              {t("Home.listsLabel", { count: listsCount })}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-4">
            <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700" />
            <ThemeToggle />
            <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700" />
            <LanguageSwitcher />
            <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700" />
            <HeaderSettings testId="settings-trigger-desktop"><SettingsToggles /></HeaderSettings>
            <div className="w-px h-5 bg-gray-200 dark:bg-zinc-700" />
            <form action={async () => { "use server"; await signOut(); }}>
              <button className="flex items-center gap-2 text-base text-gray-400 hover:text-red-500 transition-colors cursor-pointer">
                <LogOut size={18} aria-hidden />
                <span>{t("Home.signOut")}</span>
              </button>
            </form>
          </div>

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
              <form action={async () => { "use server"; await signOut(); }}>
                <button className="flex items-center gap-3 text-base text-red-500 hover:text-red-600 transition font-medium w-full">
                  <LogOut size={18} aria-hidden />
                  {t("Home.signOut")}
                </button>
              </form>
            </HeaderSettings>
          </div>
        </div>
      </div>

      <SpaceProvider spaceId={spaceId}>
        <SpaceSwitcher spaces={spaces} currentSpaceId={spaceId} variant="page" />
        <Suspense key={spaceId} fallback={<ListsSkeleton />}>
          <ListsDataFetcher
            userId={userId}
            userName={userName}
            userEmail={userEmail}
            spaceId={spaceId}
          />
        </Suspense>
      </SpaceProvider>
    </main>
  );
}
