/**
 * @file Attachments.tsx
 * @description Вложения карточки списка (загрузка/просмотр/удаление файлов в S3).
 *
 * Экспортирует два компонента (как AiInsight):
 *   - `AttachmentsButton` — кнопка-триггер (управляется снаружи через isOpen/onToggle).
 *   - `Attachments`       — панель со списком файлов и контролом загрузки.
 *
 * Поток загрузки — two-phase, байты идут напрямую в S3 (минуя наш сервер):
 *   1. requestUpload → presigned POST + attachmentId (PENDING-строка).
 *   2. POST файла прямо в бакет с полями из presigned.
 *   3. confirmUpload → сервер проверяет факт (HeadObject) и метит UPLOADED.
 * После успеха router.refresh() перезапрашивает Server Component с актуальным
 * списком (тот же приём, что у остального real-time через Pusher).
 */

"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import ConfirmModal from "@/components/ui/ConfirmModal";
import type { Attachment } from "@/components/lists/ListCard";
import {
  ACCEPT_ATTRIBUTE,
  MAX_FILE_SIZE,
  MAX_FILES_PER_LIST,
  formatFileSize,
  isAllowedType,
} from "@/lib/attachments";
import {
  requestUpload,
  confirmUpload,
  deleteAttachment,
  getAttachmentUrl,
} from "@/app/actions/attachments";
import { getPusherSocketId } from "@/lib/pusher-client";
import { useCurrentSpaceId } from "@/components/spaces/SpaceContext";

// ---------------------------------------------------------------------------
// Кнопка-триггер
// ---------------------------------------------------------------------------

type AttachmentsButtonProps = {
  isOpen: boolean;
  onToggle: () => void;
  /** Количество вложений — показывается бейджем рядом с названием. */
  count: number;
};

/** Кнопка-пилюля для раскрытия панели вложений (стиль как у AiInsightButton). */
export function AttachmentsButton({
  isOpen,
  onToggle,
  count,
}: AttachmentsButtonProps) {
  const t = useTranslations("Attachments");

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all duration-200 ${
        isOpen
          ? "bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700/50 dark:text-emerald-400"
          : "bg-white border-gray-200 text-gray-500 hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-emerald-700/50 dark:hover:text-emerald-400 dark:hover:bg-emerald-900/30"
      }`}
    >
      {/* Иконка скрепки */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="w-3.5 h-3.5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
      {t("button")}
      {count > 0 && (
        <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-gray-200 dark:bg-zinc-700 text-[10px] text-gray-600 dark:text-zinc-300">
          {count}
        </span>
      )}
      {/* Шеврон */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Панель вложений
// ---------------------------------------------------------------------------

type AttachmentsProps = {
  listId: string;
  files: Attachment[];
  currentUserId: string;
};

/** Иконка по категории файла. */
function FileIcon({ type }: { type: Attachment["type"] }) {
  if (type === "IMAGE") {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="w-4 h-4 shrink-0 text-gray-400 dark:text-zinc-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-4 h-4 shrink-0 text-gray-400 dark:text-zinc-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

/**
 * Панель вложений: список файлов + загрузка.
 * Рендерится только когда активна (управляется снаружи).
 */
export default function Attachments({
  listId,
  files,
  currentUserId,
}: AttachmentsProps) {
  const t = useTranslations("Attachments");
  const router = useRouter();
  const spaceId = useCurrentSpaceId();

  /** Скрытый input для выбора файла. */
  const inputRef = useRef<HTMLInputElement>(null);

  /** Идёт ли загрузка нового файла. */
  const [isUploading, setIsUploading] = useState(false);

  /** Файл, ожидающий подтверждения удаления (null — модал закрыт). */
  const [fileToDelete, setFileToDelete] = useState<Attachment | null>(null);

  /** Идёт ли удаление (блокирует кнопку в модале). */
  const [isDeleting, setIsDeleting] = useState(false);

  /** Достигнут ли лимит файлов на список — блокирует кнопку добавления. */
  const quotaReached = files.length >= MAX_FILES_PER_LIST;

  /** Переводит код ошибки сервера в локализованное сообщение (с фолбэком). */
  const mapError = (code?: string): string => {
    switch (code) {
      case "invalidFileType":
        return t("errors.invalidFileType");
      case "listQuotaExceeded":
        return t("errors.listQuotaExceeded");
      case "userQuotaExceeded":
        return t("errors.userQuotaExceeded");
      default:
        return t("errors.uploadFailed");
    }
  };

  /**
   * Полный цикл загрузки: requestUpload → POST в S3 → confirmUpload.
   * Клиентская валидация здесь — только для UX; настоящие проверки на S3/сервере.
   */
  const handleFileSelected = async (file: File) => {
    // Клиентская валидация (UX) — обходится через DevTools, но удобна юзеру.
    if (!isAllowedType(file.type)) {
      toast.error(t("errors.invalidFileType"));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("errors.fileTooLarge"));
      return;
    }

    setIsUploading(true);
    // ID созданной PENDING-строки. Если загрузка сорвётся на любом шаге —
    // сразу удаляем её, чтобы не держать квоту до ленивой уборки (best-effort).
    let pendingId: string | null = null;
    try {
      // Шаг 1 — presigned POST + PENDING-строка
      const req = await requestUpload({
        listId,
        spaceId,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
      if (!req.success || !req.upload) {
        toast.error(mapError(req.error));
        return;
      }
      pendingId = req.upload.attachmentId;

      // Шаг 2 — POST файла напрямую в S3.
      // Поля presigned идут ПЕРЕД файлом, файл — последним полем "file".
      const formData = new FormData();
      Object.entries(req.upload.fields).forEach(([key, value]) => {
        formData.append(key, value);
      });
      formData.append("file", file);

      const s3Response = await fetch(req.upload.url, {
        method: "POST",
        body: formData,
      });
      if (!s3Response.ok) {
        // Файл нарушил policy (размер/тип) или сеть.
        toast.error(t("errors.uploadFailed"));
        return;
      }

      // Шаг 3 — подтверждение (сервер проверяет факт через HeadObject)
      const confirmed = await confirmUpload({
        attachmentId: req.upload.attachmentId,
        spaceId,
        // Исключаем эту вкладку из Pusher-эха (данные придут с router.refresh)
        socketId: getPusherSocketId() ?? undefined,
      });
      if (!confirmed.success) {
        toast.error(mapError(confirmed.error));
        return;
      }

      // Успех — PENDING стал UPLOADED, чистить нечего.
      pendingId = null;
      // Перезапрашиваем Server Component — новый файл появится в списке.
      router.refresh();
    } catch {
      toast.error(t("errors.uploadFailed"));
    } finally {
      // Освобождаем квоту при любом провале: удаляем недозалитую PENDING-строку.
      // Best-effort — если не удалось, её всё равно уберёт ленивая уборка.
      if (pendingId) {
        await deleteAttachment({ attachmentId: pendingId, spaceId }).catch(() => {});
      }
      setIsUploading(false);
    }
  };

  /** Открывает файл по presigned GET во вкладке. */
  const handleView = async (file: Attachment) => {
    const res = await getAttachmentUrl({ attachmentId: file.id, spaceId });
    if (res.success && res.url) {
      window.open(res.url, "_blank", "noopener,noreferrer");
    } else {
      toast.error(t("errors.downloadFailed"));
    }
  };

  /** Подтверждение удаления из модала. */
  const handleConfirmDelete = async () => {
    if (!fileToDelete) return;
    const file = fileToDelete;
    setIsDeleting(true);
    setFileToDelete(null);

    const res = await deleteAttachment({
      attachmentId: file.id,
      spaceId,
      // Исключаем эту вкладку из Pusher-эха (данные придут с router.refresh)
      socketId: getPusherSocketId() ?? undefined,
    });
    if (!res.success) {
      toast.error(t("errors.deleteFailed"));
    } else {
      router.refresh();
    }
    setIsDeleting(false);
  };

  return (
    <div className="mt-2 space-y-2">
      {/* Список вложений */}
      {files.length > 0 ? (
        <ul className="space-y-1.5">
          {files.map((file) => {
            // Атрибуция с обязательным fallback: связь uploadedBy может быть null
            // (аккаунт удалён → onDelete: SetNull).
            const uploader = file.uploadedBy
              ? file.uploadedBy.id === currentUserId
                ? t("you")
                : file.uploadedBy.name || file.uploadedBy.email
              : t("unknownUser");

            return (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-lg border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50 px-2.5 py-1.5"
              >
                <FileIcon type={file.type} />

                {/* Имя + мета (размер · кто загрузил) — кликабельно для просмотра */}
                <button
                  type="button"
                  onClick={() => void handleView(file)}
                  aria-label={t("ariaView", { name: file.name })}
                  className="flex-1 min-w-0 text-left group"
                >
                  <span className="block text-xs font-medium text-gray-700 dark:text-zinc-200 truncate group-hover:underline">
                    {file.name}
                  </span>
                  <span className="block text-[10px] text-gray-400 dark:text-zinc-500 truncate">
                    {formatFileSize(file.size)} · {uploader}
                  </span>
                </button>

                {/* Удаление — доступно любому участнику списка */}
                <button
                  type="button"
                  onClick={() => setFileToDelete(file)}
                  aria-label={t("ariaDelete", { name: file.name })}
                  className="text-red-500 dark:text-red-400/50 hover:text-red-700 dark:hover:text-red-400 text-xs font-bold px-1.5 py-1 shrink-0"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-gray-400 dark:text-zinc-500 text-center py-1">
          {t("empty")}
        </p>
      )}

      {/* Скрытый input + кнопка добавления */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Сбрасываем value, чтобы повторный выбор того же файла снова сработал.
          e.target.value = "";
          if (file) void handleFileSelected(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isUploading || quotaReached}
        title={quotaReached ? t("quotaReached", { max: MAX_FILES_PER_LIST }) : undefined}
        className="w-full text-xs px-3 py-1.5 rounded-lg border border-dashed border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:border-gray-400 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5 font-medium"
      >
        {isUploading ? (
          <>
            {/* Спиннер */}
            <svg
              className="animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {t("uploading")}
          </>
        ) : quotaReached ? (
          t("quotaReached", { max: MAX_FILES_PER_LIST })
        ) : (
          <>
            {/* Плюс */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("add")}
          </>
        )}
      </button>

      {/* Подсказка по форматам */}
      {!quotaReached && (
        <p className="text-[10px] text-gray-400 dark:text-zinc-500 text-center">
          {t("hint")}
        </p>
      )}

      {/* Модал подтверждения удаления вложения */}
      {fileToDelete && (
        <ConfirmModal
          title={t("deleteModal.title")}
          body={t("deleteModal.body", { name: fileToDelete.name })}
          confirmLabel={t("deleteModal.confirm")}
          cancelLabel={t("deleteModal.cancel")}
          isConfirming={isDeleting}
          onConfirm={() => void handleConfirmDelete()}
          onCancel={() => setFileToDelete(null)}
        />
      )}
    </div>
  );
}
