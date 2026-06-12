interface Props {
  value: string;
  /** Optional one-line trend, e.g. "2 more than yesterday". */
  delta?: string;
  label: string;
  onClick: () => void;
}

/**
 * One number, one label, whole card clickable (issue #146). Nothing else.
 */
export function StatCard({ value, delta, label, onClick }: Props) {
  return (
    <button
      type="button"
      className="rounded-[10px] p-4 text-left"
      style={{ background: 'var(--color-surface)', color: 'var(--color-canvas-fg)' }}
      onClick={onClick}
    >
      <div className="text-stat font-semibold leading-tight">{value}</div>
      {delta && (
        <div className="mt-0.5 text-caption" style={{ color: 'var(--color-muted)' }}>
          {delta}
        </div>
      )}
      <div className="mt-1 text-secondary" style={{ color: 'var(--color-muted)' }}>
        {label}
      </div>
    </button>
  );
}
