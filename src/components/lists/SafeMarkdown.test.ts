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
});
