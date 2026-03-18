/**
 * @file Highlight.tsx
 * @description Компонент для подсветки поискового совпадения в тексте.
 *
 * Разбивает строку на три части: до совпадения, само совпадение, после совпадения.
 * Совпадение оборачивается в <mark> с жёлтым фоном.
 */

/**
 * Подсвечивает первое вхождение `query` в `text`.
 * Сравнение регистронезависимое, оригинальный регистр текста сохраняется.
 */
export default function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-yellow-200 text-inherit rounded-sm px-0">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}
