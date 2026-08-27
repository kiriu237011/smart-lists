/**
 * @file eslint-xss-guard.test.ts
 * @description Проверка защиты от вставок сырого HTML.
 *
 * Тест прогоняет настоящий конфиг ESLint по фрагментам кода и убеждается, что
 * запрещённые конструкции действительно дают ошибку. Проверять состав правил
 * в объекте конфига бессмысленно: правило можно объявить и не применить —
 * например, промахнувшись мимо `files`.
 *
 * Зачем правило вообще: приложение рендерит недоверенный текст, и сырой HTML —
 * единственный вектор XSS, который здесь может появиться. Полная CSP с nonce
 * закрывала бы ту же регрессию, но дороже и с риском тихо сломать прод. См.
 * `PROJECT_MEMORY.md`, раздел «Заголовки безопасности».
 */

import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

/** Возвращает id правил, сработавших на фрагменте под видом файла `filePath`. */
async function ruleIdsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId ?? "");
}

describe("защита от сырого HTML", () => {
  it("не допускает запрещённые XSS-конструкции в актуальном src", async () => {
    const results = await eslint.lintFiles(["src/**/*.{ts,tsx}"]);
    const violations = results.flatMap((result) =>
      result.messages
        .filter((message) =>
          ["react/no-danger", "no-restricted-imports"].includes(
            message.ruleId ?? "",
          ),
        )
        .map((message) => ({
          filePath: result.filePath,
          line: message.line,
          ruleId: message.ruleId,
        })),
    );

    expect(violations).toEqual([]);
  }, 30_000);

  it("запрещает dangerouslySetInnerHTML в коде приложения", async () => {
    const code = `export function Danger({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
`;
    const ruleIds = await ruleIdsFor(code, "src/components/Danger.tsx");
    expect(ruleIds).toContain("react/no-danger");
  });

  it("запрещает импорт rehype-raw", async () => {
    const code = `import rehypeRaw from "rehype-raw";

export const plugins = [rehypeRaw];
`;
    const ruleIds = await ruleIdsFor(code, "src/lib/markdown.ts");
    expect(ruleIds).toContain("no-restricted-imports");
  });

  it("не мешает обычной разметке", async () => {
    const code = `export function Safe({ text }: { text: string }) {
  return <p>{text}</p>;
}
`;
    const ruleIds = await ruleIdsFor(code, "src/components/Safe.tsx");
    expect(ruleIds).not.toContain("react/no-danger");
    expect(ruleIds).not.toContain("no-restricted-imports");
  });

  it("оставляет остальные импорты разрешёнными", async () => {
    const code = `import ReactMarkdown from "react-markdown";

export const md = ReactMarkdown;
`;
    const ruleIds = await ruleIdsFor(code, "src/components/Md.tsx");
    expect(ruleIds).not.toContain("no-restricted-imports");
  });
});
