import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Content Security Policy: только директивы, не требующие per-request nonce.
 *
 * `default-src`, `script-src`, `style-src`, `connect-src` и `img-src`
 * намеренно НЕ заданы. Без `default-src` браузер эти типы ресурсов не
 * ограничивает, поэтому заголовок ничего не ломает, а корректный `script-src`
 * требует nonce на каждый запрос: Next.js инлайнит bootstrap и RSC payload,
 * их содержимое меняется от запроса к запросу, и hash-подход неприменим.
 * Nonce выдаётся только из `proxy.ts` и переводит страницы в динамический
 * рендеринг — это отдельная задача.
 *
 * Здесь заголовок статический и отдаётся из `headers()`, а не из `proxy.ts`,
 * поэтому попадает и на `/api/*`, и на `/auth-error` — оба исключены из
 * матчера proxy.
 */
const contentSecurityPolicy = [
  // Запрещает инъекцию <base>: подменённый base переадресует все
  // относительные URL страницы на чужой домен.
  "base-uri 'self'",
  // Отключает <object>/<embed>: приложение не использует плагины, а через них
  // обходят фильтрацию разметки.
  "object-src 'none'",
  // Современная замена X-Frame-Options: DENY. Старый заголовок оставлен —
  // он формально устарел, но понятен всем браузерам.
  "frame-ancestors 'none'",
  // Куда разрешено отправлять формы. accounts.google.com нужен из-за
  // прогрессивного улучшения: без JS форма входа уходит обычным POST, и
  // Auth.js отвечает редиректом на Google, а Chrome проверяет form-action по
  // всей цепочке редиректов. С включённым JS редирект выполняет роутер и
  // директива не применяется. В Preview цель та же: redirect proxy Auth.js
  // подменяет только `redirect_uri`, а не адрес, куда уходит браузер.
  "form-action 'self' https://accounts.google.com",
].join("; ");

const securityHeaders = [
  // Частичная CSP: подмена <base>, плагины, фрейминг и цели форм (см. выше)
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
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

export const nextConfig: NextConfig = {
  poweredByHeader: false,
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
