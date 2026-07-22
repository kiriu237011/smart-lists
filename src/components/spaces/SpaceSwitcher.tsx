"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  createSpace,
  deleteSpace,
  getSpaceDeleteImpact,
  rememberSpace,
  renameSpace,
} from "@/app/actions/spaces";

export type SpaceOption = {
  id: string;
  name: string | null;
  isDefault: boolean;
};

type DeleteImpact = {
  lists: number;
  groups: number;
  receivedShares: number;
  files: number;
  collaborators: number;
};

export default function SpaceSwitcher({
  spaces,
  currentSpaceId,
  variant = "page",
  rememberCurrentSpace = true,
}: {
  spaces: SpaceOption[];
  currentSpaceId: string;
  variant?: "page" | "header";
  rememberCurrentSpace?: boolean;
}) {
  const t = useTranslations("Spaces");
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "create" | "rename" | "delete">("idle");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [pendingSpace, setPendingSpace] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const current = spaces.find((space) => space.id === currentSpaceId) ?? spaces[0];
  const displayName = (space: SpaceOption) =>
    space.name ?? (space.isDefault ? t("defaultName") : "");
  const isHeader = variant === "header";

  useEffect(() => {
    if (!rememberCurrentSpace) return;
    void rememberSpace(currentSpaceId);
  }, [currentSpaceId, rememberCurrentSpace]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setMode("idle");
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const showError = (code?: string) => {
    setError(t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.unknownError"));
  };

  const switchTo = (spaceId: string) => {
    setOpen(false);
    setMode("idle");
    if (spaceId === currentSpaceId) return;

    const target = spaces.find((space) => space.id === spaceId);
    if (!target) return;
    setPendingSpace({ id: target.id, name: displayName(target) });

    startTransition(async () => {
      await rememberSpace(spaceId);
      router.push(`/spaces/${spaceId}`);
    });
  };

  const submitCreate = () => {
    setPendingSpace(null);
    startTransition(async () => {
      const result = await createSpace(value);
      if (!result.success || !result.space) {
        showError(result.error);
        return;
      }
      setValue("");
      await rememberSpace(result.space.id);
      router.push(`/spaces/${result.space.id}`);
    });
  };

  const submitRename = () => {
    if (!current) return;
    setPendingSpace(null);
    startTransition(async () => {
      const result = await renameSpace(current.id, value);
      if (!result.success) {
        showError(result.error);
        return;
      }
      setMode("idle");
      setValue("");
      router.refresh();
    });
  };

  const prepareDelete = () => {
    if (!current || current.isDefault) return;
    setPendingSpace(null);
    startTransition(async () => {
      const result = await getSpaceDeleteImpact(current.id);
      if (!result.success || !result.impact) {
        showError(result.error);
        return;
      }
      setImpact(result.impact);
      setValue("");
      setMode("delete");
    });
  };

  const submitDelete = () => {
    if (!current) return;
    setPendingSpace(null);
    startTransition(async () => {
      const result = await deleteSpace(current.id, value);
      if (!result.success) {
        showError(result.error);
        return;
      }
      const fallback = spaces.find((space) => space.isDefault);
      if (fallback) {
        await rememberSpace(fallback.id);
        router.push(`/spaces/${fallback.id}`);
      }
    });
  };

  return (
    <>
      {isPending && pendingSpace && pendingSpace.id !== currentSpaceId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/10 backdrop-blur-[2px] dark:bg-black/40">
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-3 rounded-2xl bg-white/90 px-8 py-6 shadow-lg dark:bg-zinc-900/90"
          >
            <div className="rounded-xl bg-indigo-50 p-2.5 text-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-300">
              <Layers3 size={32} aria-hidden />
            </div>
            <p className="max-w-72 text-center text-sm font-medium text-gray-500 dark:text-zinc-400">
              {t("switchingTo", { name: pendingSpace.name })}
            </p>
            <LoaderCircle
              size={20}
              aria-hidden
              className="animate-spin text-gray-400"
            />
          </div>
        </div>
      )}

      <div
        ref={rootRef}
        className={
          isHeader
            ? "relative hidden w-max max-w-64 shrink-0 xl:block"
            : "relative mb-5 xl:hidden"
        }
      >
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setMode("idle");
          setError(null);
        }}
        className={
          isHeader
            ? "inline-flex max-w-64 items-center gap-2 rounded-xl px-3 py-2 text-left transition hover:bg-gray-50 dark:hover:bg-zinc-800"
            : "flex w-full items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3 text-left shadow-sm transition hover:border-gray-200 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
        }
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block text-xs text-gray-400 dark:text-zinc-500">{t("label")}</span>
          <span className="block truncate font-semibold text-gray-800 dark:text-zinc-100">
            {current ? displayName(current) : t("defaultName")}
          </span>
        </span>
        <ChevronDown
          size={isHeader ? 16 : 18}
          aria-hidden
          className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={
            isHeader
              ? "absolute left-0 z-30 mt-2 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-gray-100 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
              : "absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-xl border border-gray-100 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          }
        >
          <div className="max-h-64 overflow-y-auto">
            {spaces.map((space) => (
              <button
                key={space.id}
                type="button"
                onClick={() => switchTo(space.id)}
                disabled={isPending}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                  space.id === currentSpaceId
                    ? "bg-gray-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-gray-700 hover:bg-gray-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="truncate">{displayName(space)}</span>
                {space.id === currentSpaceId && <Check size={16} aria-hidden />}
              </button>
            ))}
          </div>

          <div className="my-2 h-px bg-gray-100 dark:bg-zinc-800" />

          {mode === "create" || mode === "rename" ? (
            <div className="space-y-2 p-1">
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={value}
                  maxLength={50}
                  onChange={(event) => setValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && value.trim()) {
                      if (mode === "create") submitCreate();
                      else submitRename();
                    }
                    if (event.key === "Escape") setMode("idle");
                  }}
                  placeholder={mode === "create" ? t("newPlaceholder") : t("renamePlaceholder")}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-gray-500 dark:border-zinc-700 dark:bg-zinc-800"
                />
                <button
                  type="button"
                  disabled={isPending || !value.trim()}
                  onClick={mode === "create" ? submitCreate : submitRename}
                  className="rounded-lg bg-gray-900 px-3 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {t("save")}
                </button>
                <button type="button" onClick={() => setMode("idle")} aria-label={t("cancel")}>
                  <X size={18} />
                </button>
              </div>
            </div>
          ) : mode === "delete" && current && impact ? (
            <div className="space-y-3 p-2 text-sm">
              <p className="font-semibold text-red-600">{t("deleteTitle")}</p>
              <p className="text-gray-500 dark:text-zinc-400">
                {t("deleteImpact", impact)}
              </p>
              <p className="text-gray-500 dark:text-zinc-400">
                {t("deletePrompt", { name: displayName(current) })}
              </p>
              <input
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 outline-none dark:border-red-900 dark:bg-red-950/30"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMode("idle")} className="px-3 py-2">
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  onClick={submitDelete}
                  disabled={isPending || !value.trim()}
                  className="rounded-lg bg-red-600 px-3 py-2 text-white disabled:opacity-40"
                >
                  {t("delete")}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-1">
              <button
                type="button"
                disabled={spaces.filter((space) => !space.isDefault).length >= 5}
                onClick={() => {
                  setValue("");
                  setError(null);
                  setMode("create");
                }}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Plus size={16} /> {t("create", { current: spaces.length - 1, max: 5 })}
              </button>
              <button
                type="button"
                onClick={() => {
                  setValue(current ? displayName(current) : "");
                  setError(null);
                  setMode("rename");
                }}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Pencil size={16} /> {t("rename")}
              </button>
              {!current?.isDefault && (
                <button
                  type="button"
                  onClick={prepareDelete}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <Trash2 size={16} /> {t("delete")}
                </button>
              )}
            </div>
          )}

          {error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
        </div>
      )}
      </div>
    </>
  );
}
