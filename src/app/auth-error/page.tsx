import { getAuthErrorContent } from "@/lib/auth-errors";

/**
 * Страница ошибки авторизации.
 * Auth.js передаёт безопасный код ошибки в query-параметре `error`.
 * Внутренние детали OAuth и конфигурации пользователю не раскрываются.
 */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const content = getAuthErrorContent(error);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-24">
      <h1 className="text-3xl sm:text-4xl font-bold mb-6 dark:text-white">
        {content.title}
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-2 text-center max-w-sm">
        {content.description}
      </p>
      <p className="text-gray-400 dark:text-gray-500 text-sm text-center max-w-sm">
        {content.hint}
      </p>
    </main>
  );
}
