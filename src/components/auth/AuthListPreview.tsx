type AuthListPreviewProps = {
  title: string;
  progress: string;
  shared: string;
  items: [string, string, string, string];
  note: string;
};

/**
 * Декоративное превью списка на экране входа.
 *
 * Компонент намеренно остаётся серверным и не имитирует рабочие элементы:
 * его задача — быстро объяснить назначение продукта без лишнего JavaScript.
 */
export default function AuthListPreview({
  title,
  progress,
  shared,
  items,
  note,
}: AuthListPreviewProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="auth-list-preview"
      className="relative mx-auto w-full max-w-[31rem] select-none"
    >
      <div className="absolute -left-5 top-14 hidden h-[82%] w-full -rotate-3 rounded-[2rem] border border-indigo-100 bg-indigo-50/70 sm:block dark:border-indigo-900/40 dark:bg-indigo-950/30" />
      <div className="absolute -right-4 -top-5 z-10 flex items-center gap-2 rounded-full border border-white/80 bg-white/90 px-3 py-2 text-xs font-semibold text-gray-600 shadow-lg shadow-indigo-950/5 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-900/90 dark:text-zinc-300 dark:shadow-black/30">
        <span className="flex -space-x-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-amber-100 text-[9px] font-bold text-amber-700 dark:border-zinc-900 dark:bg-amber-900/60 dark:text-amber-200">A</span>
          <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-sky-100 text-[9px] font-bold text-sky-700 dark:border-zinc-900 dark:bg-sky-900/60 dark:text-sky-200">M</span>
        </span>
        {shared}
      </div>

      <div className="relative overflow-hidden rounded-[2rem] border border-gray-200/80 bg-white p-5 shadow-2xl shadow-indigo-950/10 sm:p-7 dark:border-zinc-700/80 dark:bg-zinc-900 dark:shadow-black/50">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 h-1.5 w-8 rounded-full bg-indigo-500" />
            <h2 className="text-xl font-bold tracking-tight text-gray-950 sm:text-2xl dark:text-white">{title}</h2>
          </div>
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">{progress}</span>
        </div>

        <div className="space-y-1.5">
          <PreviewItem checked label={items[0]} />
          <PreviewItem label={items[1]} />
          <PreviewItem label={items[2]} note={note} />
          <PreviewItem checked label={items[3]} />
        </div>

        <div className="mt-6 border-t border-gray-100 pt-5 dark:border-zinc-800">
          <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-gray-400 dark:text-zinc-500">
            <span>{progress}</span>
            <span>50%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-zinc-800">
            <div className="h-full w-1/2 rounded-full bg-indigo-500" />
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewItem({
  checked = false,
  label,
  note,
}: {
  checked?: boolean;
  label: string;
  note?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl px-2 py-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
          checked
            ? "border-indigo-500 bg-indigo-500 text-white"
            : "border-gray-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
        }`}
      >
        {checked && (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
            <path d="m5 10 3 3 7-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            checked
              ? "text-gray-400 line-through dark:text-zinc-500"
              : "text-gray-700 dark:text-zinc-200"
          }`}
        >
          {label}
        </p>
        {note && (
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M4.5 3.5h11v13h-11zM7 7h6M7 10h4" />
            </svg>
            {note}
          </div>
        )}
      </div>
    </div>
  );
}
