/**
 * Страница ошибки авторизации.
 * NextAuth перенаправляет сюда при AccessDenied (email не в whitelist).
 */
export default function AuthErrorPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-24">
      <h1 className="text-3xl sm:text-4xl font-bold mb-6 dark:text-white">
        Доступ закрыт
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-2 text-center max-w-sm">
        Ваш аккаунт не добавлен в список разрешённых пользователей.
      </p>
      <p className="text-gray-400 dark:text-gray-500 text-sm text-center max-w-sm">
        Обратитесь к администратору, чтобы получить доступ.
      </p>
    </main>
  );
}
