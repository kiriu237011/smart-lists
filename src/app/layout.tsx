/**
 * @file layout.tsx
 * @description Корневой макет (Root Layout) приложения Next.js.
 *
 * Этот файл — обязательная точка входа в иерархию layouts в App Router.
 * Он оборачивает КАЖДУЮ страницу приложения и рендерится один раз при загрузке.
 *
 * Здесь определяются:
 * - Глобальные шрифты (Geist Sans и Geist Mono от Vercel через next/font/google)
 * - HTML-метаданные: `<title>` и `<meta name="description">` для SEO
 * - Базовая HTML-структура: `<html>` → `<body>` → `{children}`
 *
 * Все дочерние страницы и макеты рендерятся вместо `{children}`.
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Шрифт Geist Sans — основной шрифт для текста.
 * Загружается через next/font (оптимизированная загрузка, без FOUC).
 * Подключается как CSS-переменная `--font-geist-sans`.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/**
 * Шрифт Geist Mono — моноширинный шрифт для кода и технических данных.
 * Подключается как CSS-переменная `--font-geist-mono`.
 */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Метаданные страницы, используемые Next.js для генерации `<head>`.
 * Автоматически попадают в `<title>` и `<meta name="description">`.
 */
export const metadata: Metadata = {
  title: "Smart Shopping List",
  description: "A smart shopping list for the family",
};

/**
 * Корневой Layout-компонент.
 *
 * @param children - Дочернее содержимое: активная страница или вложенный layout.
 * @returns HTML-документ с подключёнными шрифтами и глобальными стилями.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
