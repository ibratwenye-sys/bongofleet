import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Stage L4 - default namespace is `common` (i18n.ts's defaultNS), so a
  // bare useTranslation() call is enough for cancel/confirm; translating
  // `confirmLabel`'s old literal default requires the hook, so the
  // fallback moved from the destructured parameter into the body, same
  // pattern DriverPicker.tsx used for its placeholder in L3.
  const { t } = useTranslation();
  const label = confirmLabel ?? t('confirm');
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-6 text-sm text-txt-2">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          {t('cancel')}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`rounded px-3 py-1.5 text-sm font-medium text-white ${
            danger ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-800'
          }`}
        >
          {label}
        </button>
      </div>
    </Modal>
  );
}
