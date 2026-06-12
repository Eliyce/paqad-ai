interface Props {
  /** The exact text a save would write right now. */
  mine: string;
  /** What is on disk now (the 409 body's conflict content). */
  theirs: string;
  saving: boolean;
  onLoadLatest: () => void;
  onKeepMine: () => void;
}

function DiffPane({ title, mine, other }: { title: string; mine: string; other: string }) {
  const lines = mine.split('\n');
  const otherLines = other.split('\n');
  return (
    <div className="min-w-0 flex-1">
      <div className="text-caption font-medium" style={{ color: 'var(--color-muted)' }}>
        {title}
      </div>
      <pre
        className="mt-1 max-h-72 overflow-auto rounded-[6px] p-2 text-caption"
        style={{ background: 'var(--color-canvas)', color: 'var(--color-canvas-fg)' }}
      >
        {lines.map((line, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <div
            key={index}
            style={
              line !== (otherLines[index] ?? '')
                ? { background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }
                : undefined
            }
          >
            {line === '' ? ' ' : line}
          </div>
        ))}
      </pre>
    </div>
  );
}

/**
 * The friendly merge prompt every managed-file editor renders on a 409
 * (issue #146, spec 6.3): a side-by-side diff of your edit against what is
 * on disk now, with exactly two ways out.
 */
export function ConflictPanel({ mine, theirs, saving, onLoadLatest, onKeepMine }: Props) {
  return (
    <div className="mt-4 rounded-[10px] p-4" style={{ background: 'var(--color-surface)' }}>
      <div className="text-body font-medium">
        This file changed since you opened it, likely by an agent. Review the diff.
      </div>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <DiffPane title="Your edit" mine={mine} other={theirs} />
        <DiffPane title="On disk now" mine={theirs} other={mine} />
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium"
          style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}
          onClick={onLoadLatest}
        >
          Load the latest version
        </button>
        <button
          type="button"
          disabled={saving}
          className="rounded-[6px] border px-3 py-1.5 text-secondary font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          onClick={onKeepMine}
        >
          Keep mine and overwrite
        </button>
      </div>
    </div>
  );
}
