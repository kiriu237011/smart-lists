import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * Proxy (ранее middleware) для интернационализации маршрутов.
 * В Next.js 16 файл переименован с middleware.ts → proxy.ts.
 *
 * При заходе на `/` автоматически редиректит на `/ru` (defaultLocale).
 * API-маршруты (`/api/...`) исключены через `matcher`.
 */
import { NextRequest } from "next/server";
import { logger } from "./lib/logger";

const intlMiddleware = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
  logger.info({ 
    method: request.method, 
    url: request.nextUrl.pathname 
  }, "Incoming request");

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|auth-error|_next/static|_next/image|favicon.ico|favicon.svg|apple-icon|icon|site.webmanifest|.*\\.png|.*\\.ico|.*\\.svg).*)"],
};
