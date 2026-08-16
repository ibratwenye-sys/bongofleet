import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Stage H0d - this component had no height limit, no overflow handling, no
 * Escape key, and no scroll lock. Because the panel is centred inside a
 * `fixed inset-0` overlay, content taller than the window overflowed *both*
 * ways: the footer buttons fell below the fold and the header (with its ✕)
 * was pushed above the top, so neither way out was reachable. Nothing
 * scrolled it back into view either - the overlay is `position: fixed`, so a
 * scroll gesture went to the page behind while the modal stayed exactly
 * where it was. The only escape was reloading the page, which threw away
 * everything typed.
 *
 * Add driver (683px of content) was the form that made this visible, but it
 * was never a Drivers-page bug: every modal in the app is built from this
 * one component and the others were simply shorter. Measured at 1280x720 -
 * a laptop screen, so a ~551px viewport once browser chrome is subtracted -
 * Log service (565px) was over the line too and would have trapped the next
 * person to open it. Create ownership plan escaped only because it carried
 * its own local `max-h-[75vh] overflow-y-auto` workaround, now removed in
 * favour of this.
 */

// Modals stack: a ConfirmDialog opens on top of a form modal (see
// OwnershipPage). Escape must close only the topmost, and the page behind
// must stay locked until the *last* one closes - so both behaviours are
// driven off this one shared stack rather than each instance acting alone.
const modalStack: symbol[] = [];

// Captured when the stack goes 0 -> 1 and restored when it returns to 0, at
// module scope rather than per-instance so the restore is correct however
// the modals are unwound (an outer modal closing before an inner one still
// leaves the inner one holding the lock).
let savedBodyOverflow = '';
let savedBodyPaddingRight = '';

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Call sites pass an inline arrow for onClose, so it is a new function on
  // every render. Held in a ref and read at call time, the effect below can
  // stay mount-only - otherwise it would tear down and re-run on every
  // keystroke in the form, popping and re-pushing the stack and releasing
  // the scroll lock each time.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const id = Symbol('modal');
    modalStack.push(id);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      // Only the topmost modal answers Escape, so dismissing a confirmation
      // does not also discard the form underneath it.
      if (modalStack[modalStack.length - 1] !== id) return;
      onCloseRef.current();
    }
    document.addEventListener('keydown', handleKeyDown);

    if (modalStack.length === 1) {
      savedBodyOverflow = document.body.style.overflow;
      savedBodyPaddingRight = document.body.style.paddingRight;
      // Hiding the body's overflow removes the scrollbar, which would let
      // the page behind jump sideways by its width. Padding the same amount
      // back on keeps it still. (Scroll *position* needs no such care -
      // overflow:hidden preserves it, unlike the position:fixed approach.)
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = modalStack.indexOf(id);
      if (index !== -1) modalStack.splice(index, 1);
      if (modalStack.length === 0) {
        document.body.style.overflow = savedBodyOverflow;
        document.body.style.paddingRight = savedBodyPaddingRight;
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      {/* max-h + flex column is what bounds the panel to the window: the
          header keeps its natural height and the body takes what is left,
          scrolling internally instead of the panel growing past the edges.
          min-h-0 on the body is required - without it a flex child refuses
          to shrink below its content and the overflow returns. */}
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-lg bg-white shadow-lg">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        {/* The action buttons live inside `children` (each page's own form),
            so they scroll into reach here rather than being pinned. The ✕
            above is the always-visible way out, at any content height. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
