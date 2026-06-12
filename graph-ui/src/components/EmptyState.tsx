interface Props {
  /** What will appear here, once it exists. */
  what: string;
  /** Why it matters to the owner. */
  why: string;
  actionLabel: string;
  onAction: () => void;
}

/**
 * Empty state with three slots, always (issue #146): what will appear
 * here, why it matters, and exactly one action.
 */
export function EmptyState({ what, why, actionLabel, onAction }: Props) {
  return (
    <div className="rounded-[10px] p-6" style={{ background: 'var(--color-surface)' }}>
      <div className="text-body" style={{ color: 'var(--color-canvas-fg)' }}>
        {what}
      </div>
      <div className="mt-2 text-secondary" style={{ color: 'var(--color-muted)' }}>
        {why}
      </div>
      <button
        type="button"
        className="mt-4 rounded-[6px] border px-3 py-1.5 text-secondary font-medium"
        style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  );
}
