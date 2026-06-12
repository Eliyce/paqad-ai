import { useEffect, useRef, useState } from 'react';

interface Props {
  title: string;
  problem: string;
  benefit: string;
  without: string;
  docsHref?: string;
  onClose: () => void;
}

/**
 * Right-side why drawer (issue #146). 360px wide, slides in over 200ms
 * ease-out, closes on Escape and backdrop click. Carries the only soft
 * shadow in the app. Three blocks: the problem, what you get, what
 * happens without it.
 */
export function WhyDrawer({ title, problem, benefit, without, docsHref, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Slide in on mount.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Focus lands on the close button; Escape closes; Tab stays inside.
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const block = (label: string, body: string): React.ReactNode => (
    <div className="mt-5">
      <div className="text-secondary font-medium" style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
      <div className="mt-1 text-body" style={{ color: 'var(--color-canvas-fg)' }}>
        {body}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 h-full w-full cursor-default"
        style={{ background: 'rgba(15, 23, 42, 0.2)' }}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="absolute top-0 right-0 flex h-full w-[360px] max-w-full flex-col overflow-y-auto p-6"
        style={{
          background: 'var(--color-surface)',
          boxShadow: '-8px 0 24px rgba(15, 23, 42, 0.12)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms ease-out',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-section font-semibold" style={{ color: 'var(--color-canvas-fg)' }}>
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            className="rounded-[6px] px-2 py-1 text-secondary"
            style={{ color: 'var(--color-muted)' }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {block('The problem', problem)}
        {block('What you get', benefit)}
        {without && block('What happens without it', without)}
        {docsHref && (
          <div className="mt-auto pt-6">
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              className="text-secondary"
              style={{ color: 'var(--color-accent)' }}
            >
              Read the docs
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
