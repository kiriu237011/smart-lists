import ReactMarkdown, { type Components } from "react-markdown";

/**
 * Безопасный поднабор Markdown для недоверенного ответа AI.
 *
 * Сырой HTML `react-markdown` не исполняет по умолчанию, а ссылки здесь
 * дополнительно превращаются в обычный текст. Иначе prompt injection в
 * расшаренном списке могла бы заставить модель показать другому участнику
 * кликабельную фишинговую ссылку от имени приложения.
 */
const components: Components = {
  p: ({ node, ...props }) => {
    void node;
    return <p className="mb-2 last:mb-0" {...props} />;
  },
  strong: ({ node, ...props }) => {
    void node;
    return (
      <strong
        className="font-semibold text-gray-900 dark:text-gray-100"
        {...props}
      />
    );
  },
  ul: ({ node, ...props }) => {
    void node;
    return (
      <ul
        className="list-disc pl-4 mb-2 last:mb-0 space-y-1"
        {...props}
      />
    );
  },
  ol: ({ node, ...props }) => {
    void node;
    return (
      <ol
        className="list-decimal pl-4 mb-2 last:mb-0 space-y-1"
        {...props}
      />
    );
  },
  li: ({ node, ...props }) => {
    void node;
    return <li className="pl-1" {...props} />;
  },
  a: ({ node, href, ...props }) => {
    void node;
    void href;
    return <span {...props} />;
  },
};

export default function SafeMarkdown({ children }: { children: string }) {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
}
