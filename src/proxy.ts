import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/**
 * Proxy (ранее middleware) для интернационализации маршрутов.
 * В Next.js 16 файл переименован с middleware.ts → proxy.ts.
 *
 * При заходе на `/` автоматически редиректит на `/ru` (defaultLocale).
 * API-маршруты (`/api/...`) исключены через `matcher`.
 */
export default createMiddleware(routing);

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
