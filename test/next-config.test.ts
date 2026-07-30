/**
 * @file next-config.test.ts
 * @description Проверка настроек, уменьшающих раскрытие деталей платформы,
 * и состава заголовков безопасности.
 */

import { describe, expect, it } from "vitest";

import { nextConfig } from "../next.config";

/** Возвращает значение заголовка, отдаваемого приложением на все маршруты. */
async function headerValue(key: string): Promise<string | undefined> {
  const rules = await nextConfig.headers!();
  const rule = rules.find((entry) => entry.source === "/:path*");
  return rule?.headers.find((header) => header.key === key)?.value;
}

/** Разбирает CSP на директивы: `{ "base-uri": "'self'" }`. */
async function cspDirectives(): Promise<Record<string, string>> {
  const value = await headerValue("Content-Security-Policy");
  if (!value) return {};
  return Object.fromEntries(
    value.split(";").map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values.join(" ")];
    }),
  );
}

describe("nextConfig", () => {
  it("не публикует X-Powered-By", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});

describe("Content-Security-Policy", () => {
  it("отдаётся на все маршруты", async () => {
    await expect(headerValue("Content-Security-Policy")).resolves.toBeTruthy();
  });

  it("запрещает подмену <base> и плагины", async () => {
    const directives = await cspDirectives();
    expect(directives["base-uri"]).toBe("'self'");
    expect(directives["object-src"]).toBe("'none'");
  });

  it("запрещает встраивание во фрейм, дублируя X-Frame-Options", async () => {
    const directives = await cspDirectives();
    expect(directives["frame-ancestors"]).toBe("'none'");
    await expect(headerValue("X-Frame-Options")).resolves.toBe("DENY");
  });

  it("разрешает отправку форм только на себя и на Google OAuth", async () => {
    // accounts.google.com обязателен: без JS форма входа уходит POST-ом, и
    // Chrome проверяет form-action на редиректе Auth.js к провайдеру.
    const formAction = (await cspDirectives())["form-action"];
    expect(formAction).toBe("'self' https://accounts.google.com");
  });

  it("не ограничивает ресурсы, которым нужен nonce", async () => {
    // Страховка от преждевременного ужесточения: `default-src` или
    // `script-src` без per-request nonce из `proxy.ts` заблокируют инлайновый
    // bootstrap Next.js и уронят приложение целиком. Ужесточая политику,
    // сначала научите proxy выдавать nonce, потом снимайте эту проверку.
    const directives = await cspDirectives();
    expect(directives).not.toHaveProperty("default-src");
    expect(directives).not.toHaveProperty("script-src");
    expect(directives).not.toHaveProperty("style-src");
    expect(directives).not.toHaveProperty("connect-src");
    expect(directives).not.toHaveProperty("img-src");
  });
});
