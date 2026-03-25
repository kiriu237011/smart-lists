/**
 * @file ConfirmModal.tsx
 * @description Переиспользуемый модал подтверждения действия.
 *
 * Используется для подтверждения удаления списка и выхода из расшаренного списка.
 * Оба сценария имеют идентичную структуру UI — один общий компонент.
 *
 * Важно: клавиатурная обработка (Esc/Enter) остаётся во внешнем коде (ListsContainer),
 * чтобы не дублировать логику и не привязывать модал к конкретному действию.
 *
 * Сам компонент отвечает только за отображение UI: overlay, диалог, кнопки.
 * Доступность: aria-modal, role="dialog".
 */

"use client";

/** Пропсы компонента `ConfirmModal`. */
type ConfirmModalProps = {
  /** Заголовок диалога. */
  title: string;
  /** Поясняющий текст (описание последствия действия). */
  body: string;
  /** Текст кнопки подтверждения. */
  confirmLabel: string;
  /** Текст кнопки отмены. */
  cancelLabel: string;
  /** Флаг ожидания ответа сервера — блокирует повторное нажатие. */
  isConfirming: boolean;
  /** Колбэк подтверждения действия. */
  onConfirm: () => void;
  /** Колбэк отмены / закрытия модала. */
  onCancel: () => void;
};

/**
 * Переиспользуемый модал подтверждения.
 *
 * Рендерит overlay с диалоговым окном. Клик по overlay закрывает модал.
 * Клик внутри диалога не всплывает на overlay (stopPropagation).
 *
 * Клавиатурная поддержка (Esc/Enter) реализована снаружи — в ListsContainer,
 * где есть доступ к контексту конкретного действия.
 *
 * @param title - Заголовок диалога.
 * @param body - Поясняющий текст.
 * @param confirmLabel - Метка кнопки подтверждения.
 * @param cancelLabel - Метка кнопки отмены.
 * @param isConfirming - Блокирует кнопку подтверждения во время запроса.
 * @param onConfirm - Вызывается при клике на кнопку подтверждения.
 * @param onCancel - Вызывается при клике на overlay или кнопку отмены.
 */
export default function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  isConfirming,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white dark:bg-zinc-800 dark:border dark:border-zinc-700 p-5 shadow-lg dark:shadow-2xl dark:shadow-black/70"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-zinc-400 mb-5">{body}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-2 rounded-md text-sm border border-gray-300 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isConfirming}
            onClick={onConfirm}
            className="px-3 py-2 rounded-md text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
