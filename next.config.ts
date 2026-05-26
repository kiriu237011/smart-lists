import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const securityHeaders = [
  // Запрещает встраивание страницы в <iframe> на других сайтах (clickjacking)
  { key: "X-Frame-Options", value: "DENY" },
  // Запрещает браузеру угадывать MIME-тип файла (MIME-sniffing)
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Ограничивает информацию в заголовке Referer при переходе на внешние сайты
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Отключает доступ к браузерным API, которые приложение не использует
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Форсирует HTTPS на 1 год (только на проде, браузер игнорирует на localhost)
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
