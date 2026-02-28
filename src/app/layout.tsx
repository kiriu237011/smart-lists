/**
 * @file layout.tsx
 * @description Минимальный корневой layout.
 *
 * HTML-структура, шрифты и провайдеры определяются в app/[locale]/layout.tsx.
 * Этот файл нужен Next.js как обязательная точка входа в иерархию layouts.
 */

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // HTML-обёртка находится в app/[locale]/layout.tsx
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return children as any;
}
