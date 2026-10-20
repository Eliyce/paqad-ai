import { useEffect, useState } from 'react';

interface Props {
  children: React.ReactNode;
  onDone?: () => void;
}

export function WinLine({ children, onDone }: Props) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 4000);
    const doneTimer = setTimeout(() => onDone?.(), 4250);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(doneTimer);
    };
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
