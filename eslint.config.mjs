import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Защита от единственного вектора XSS, который реально может появиться в
    // этом коде, — вставки сырого HTML. Приложение рендерит недоверенный текст
    // (названия списков, заметки, ответ AI-сервиса), и пока весь он проходит
    // через экранирование React и `react-markdown` без `rehype-raw`,
    // инъекции разметки нет.
    //
    // Это осознанная замена `script-src` в CSP: полная политика с nonce
    // защищала бы ровно от такой регрессии, но стоит четырёх точек интеграции
    // и способна тихо сломать прод, тогда как линтер ловит ту же ошибку в CI
    // до мержа. Подробности и границы решения — в `PROJECT_MEMORY.md`,
    // раздел «Заголовки безопасности».
    //
    // Снимать правило точечным `eslint-disable` можно, но каждый случай
    // обязан объяснять, откуда взят HTML и почему он доверенный.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "react/no-danger": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "rehype-raw",
              message:
                "rehype-raw отключает экранирование HTML в react-markdown и открывает XSS на недоверенном тексте. Если разметка действительно нужна, добавляй вместе с rehype-sanitize и обнови PROJECT_MEMORY.",
            },
          ],
        },
      ],
    },
  },
  {
    // Фикстуры Playwright устроены как `async ({ deps }, use) => { await use(value) }`.
    // Плагин react-hooks видит вызов `use(...)` и принимает его за React-хук `use`,
    // который в обычной функции запрещён. К React это отношения не имеет.
    files: ["test/e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
