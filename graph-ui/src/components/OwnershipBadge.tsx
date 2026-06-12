import type { InventoryOwner } from '../lib/dashboard-types';

const LABEL: Record<InventoryOwner, string> = {
  you: 'You manage this',
  paqad: 'Paqad manages this',
  shared: 'Shared',
};

/**
 * Quiet ownership marker (issue #146): a 6px dot plus text, 12px,
 * secondary color. Placed top right of cards and beside page titles.
 * Never color-only: the dot is always paired with the label.
 */
export function OwnershipBadge({ managedBy }: { managedBy: InventoryOwner }) {
  const dotStyle: React.CSSProperties =
    managedBy === 'you'
      ? { background: 'var(--color-accent)' }
      : managedBy === 'paqad'
        ? { background: 'var(--color-muted)' }
        : { background: 'transparent', border: '1px solid var(--color-accent)' };

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-caption"
      style={{ color: 'var(--color-muted)' }}
    >
      <span
        aria-hidden="true"
        className="inline-block rounded-full"
        style={{ width: 6, height: 6, ...dotStyle }}
      />
      {LABEL[managedBy]}
    </span>
  );
}
