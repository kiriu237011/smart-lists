/**
 * @file Notes.tsx
 * @description Общий редактор plain-text заметок и панель заметки списка.
 *
 * Редактор сохраняет текст только по явному действию пользователя. Версия,
 * полученная при открытии, передаётся в API: если заметку уже изменили в другой
 * вкладке или другой участник, черновик остаётся на экране и показывается выбор.
 */

"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useListsApi, type NoteActionResult } from "@/components/providers/ListsApiProvider";
import Highlight from "@/components/ui/Highlight";
import { getNoteExcerpt, MAX_NOTE_LENGTH, normalizeNote } from "@/lib/notes";

type Conflict = {
  note: string;
  version: number;
};

type EditorState = {
  draft: string;
  baseNote: string;
  baseVersion: number;
  conflict: Conflict | null;
};

type NoteEditorProps = {
  note: string | null;
  version: number;
  onSave: (note: string, expectedVersion: number) => Promise<NoteActionResult>;
  onCancel: () => void;
  onSaved?: (note: string | null, version: number) => void;
  compact?: boolean;
};

/** Иконка заметки; заполненная версия показывает, что текст уже существует. */
export function NoteIcon({
  filled = false,
  size = 14,
}: {
  filled?: boolean;
  size?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      {filled && <line x1="8" y1="17" x2="13" y2="17" />}
    </svg>
  );
}

/** Компактная кнопка заметки списка для правой части шапки карточки. */
export function ListNoteButton({
  note,
  isOpen,
  onToggle,
}: {
  note: string | null;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("Notes");
  const label = note ? t("listNote") : t("addListNote");

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-expanded={isOpen}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        isOpen || note
          ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-950/80"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
      }`}
    >
      <NoteIcon filled={Boolean(note)} size={16} />
    </button>
  );
}

/** Универсальный редактор заметки списка или записи. */
export function NoteEditor({
  note,
  version,
  onSave,
  onCancel,
  onSaved,
  compact = false,
}: NoteEditorProps) {
  const t = useTranslations("Notes");
  const [state, setState] = useState<EditorState>({
    draft: note ?? "",
    baseNote: note ?? "",
    baseVersion: version,
    conflict: null,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = state.draft !== state.baseNote;

  // При открытии и каждом изменении текста textarea занимает ровно столько
  // высоты, сколько нужно всему содержимому — без внутреннего скролла.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [state.draft]);

  // Свежие props приходят через Pusher/RSC. Чистый редактор синхронизируем,
  // а при наличии черновика сохраняем его и лишь отмечаем конфликт.
  useEffect(() => {
    if (version === state.baseVersion) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((current) => {
      if (current.draft === current.baseNote) {
        return {
          draft: note ?? "",
          baseNote: note ?? "",
          baseVersion: version,
          conflict: null,
        };
      }
      return {
        ...current,
        conflict: { note: note ?? "", version },
      };
    });
  }, [note, version, state.baseVersion]);

  const save = async (expectedVersion: number) => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);

    const result = await onSave(state.draft, expectedVersion);
    setIsSaving(false);

    if (result.success) {
      const savedNote = result.note === undefined ? normalizeNote(state.draft) : result.note;
      const savedVersion = result.noteVersion ?? expectedVersion;
      setState({
        draft: savedNote ?? "",
        baseNote: savedNote ?? "",
        baseVersion: savedVersion,
        conflict: null,
      });
      onSaved?.(savedNote ?? null, savedVersion);
      return;
    }

    if (result.error === "noteConflict") {
      setState((current) => ({
        ...current,
        conflict: {
          note: result.currentNote ?? "",
          version: result.currentVersion ?? expectedVersion,
        },
      }));
      return;
    }

    setError(result.error === "tooLong" ? t("tooLong") : t("saveFailed"));
  };

  return (
    <div className={`${compact ? "mt-2" : "mt-3"} space-y-2`}>
      <div className="relative">
        <textarea
          ref={textareaRef}
          autoFocus
          value={state.draft}
          onChange={(event) => setState((current) => ({ ...current, draft: event.target.value }))}
          rows={compact ? 3 : 5}
          maxLength={MAX_NOTE_LENGTH}
          placeholder={t("placeholder")}
          className="w-full resize-none overflow-hidden rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 pb-7 text-sm text-gray-700 outline-none transition focus:bg-white focus:ring-1 ring-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:bg-zinc-900 dark:ring-zinc-500"
        />
        <span
          className={`absolute bottom-2 right-2 text-[10px] ${
            state.draft.length >= MAX_NOTE_LENGTH
              ? "font-medium text-red-500 dark:text-red-400"
              : "text-gray-400 dark:text-zinc-500"
          }`}
        >
          {state.draft.length}/{MAX_NOTE_LENGTH}
        </span>
      </div>

      {state.conflict && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
          <p>{t("conflict")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                setState({
                  draft: state.conflict?.note ?? "",
                  baseNote: state.conflict?.note ?? "",
                  baseVersion: state.conflict?.version ?? state.baseVersion,
                  conflict: null,
                })
              }
              className="rounded-md border border-amber-300 px-2 py-1 hover:bg-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/40"
            >
              {t("loadLatest")}
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void save(state.conflict?.version ?? state.baseVersion)}
              className="rounded-md bg-amber-700 px-2 py-1 text-white hover:bg-amber-800 disabled:opacity-50"
            >
              {t("overwrite")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={() => void save(state.baseVersion)}
          disabled={isSaving || (!isDirty && !state.conflict)}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          {isSaving ? t("saving") : t("save")}
        </button>
      </div>
    </div>
  );
}

/** Раскрывающаяся заметка всего списка. Доступна также в гостевом режиме. */
export function ListNote({
  listId,
  note,
  noteVersion,
  searchQuery,
  isOpen,
  onClose,
}: {
  listId: string;
  note: string | null;
  noteVersion: number;
  searchQuery: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const api = useListsApi();
  const query = searchQuery.trim();
  const noteMatches = Boolean(
    note && query && note.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );

  if (!isOpen && !noteMatches) return null;

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
      {!isOpen && noteMatches && note && (
        <p className="text-xs leading-relaxed text-gray-600 dark:text-zinc-300">
          <Highlight text={getNoteExcerpt(note, query)} query={query} />
        </p>
      )}

      {isOpen && (
        <NoteEditor
          note={note}
          version={noteVersion}
          onSave={(draft, expectedVersion) => api.updateListNote(listId, draft, expectedVersion)}
          onCancel={onClose}
          onSaved={onClose}
        />
      )}
    </div>
  );
}
