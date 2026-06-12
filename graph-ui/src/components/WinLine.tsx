import { useEffect, useState } from 'react';

interface Props {
  children: React.ReactNode;
  /** Called once the line has fully faded out, about 4 seconds in. */
  onDone?: () => void;
}

/**
 * One-line confirmation with an accent dot (issue #146). Visible for
 * 4 seconds, then fades out over 250ms and calls onDone. Reuse-friendly
 * so the Approvals win line can migrate here later.
 */
export function WinLine({ children, onDone }: Props) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 4000);
    const doneTimer = setTimeout(() => onDone?.(), 4250);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
    // onDone is intentionally captured once; the timers run a single cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="flex items-center gap-2 text-secondary"
      style={{
        color: 'var(--color-canvas-fg)',
        opacity: fading ? 0 : 1,
        transition: 'opacity 250ms ease-out',
      }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: 'var(--color-accent)' }}
      />
      <span>{children}</span>
    </div>
  );
}
