import { Modal } from './Modal';

export function IdleLogoutModal({ onStay }: { onStay: () => void }) {
  return (
    <Modal title="You'll be logged out soon" onClose={onStay}>
      <p className="mb-6 text-sm text-gray-600">You'll be logged out soon due to inactivity.</p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onStay}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Stay logged in
        </button>
      </div>
    </Modal>
  );
}
