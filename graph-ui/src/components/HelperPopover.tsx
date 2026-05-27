import { useEffect, useRef, useState } from 'react';

interface Props {
  what: string;
  goodLooksLike: string;
}

/**
 * `?` affordance that opens a small popover with helper text. Never
 * visible by default — the brief is explicit about that.
 */
export function HelperPopover({ what, goodLooksLike }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="What does this section mean?"
        aria-expanded={open}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs"
        style={{
          borderColor: 'var(--color-border)',
          color: 'var(--color-muted)',
          background: 'var(--color-canvas)',
        }}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute right-0 z-10 mt-2 w-72 rounded-lg border p-3 text-xs shadow-lg"
          style={{
            background: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-canvas-fg)',
          }}
        >
          <div className="font-semibold">What this is</div>
          <div className="mt-1" style={{ color: 'var(--color-muted)' }}>
            {what}
          </div>
          <div className="mt-3 font-semibold">What good looks like</div>
          <div className="mt-1" style={{ color: 'var(--color-muted)' }}>
            {goodLooksLike}
          </div>
        </div>
      )}
    </div>
  );
}
