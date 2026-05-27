import type { SectionData } from '../lib/dashboard-types';
import { HelperPopover } from './HelperPopover';
import { ScoreBadge } from './ScoreBadge';

interface Props {
  section: SectionData;
  /** When true, the card border pulses to acknowledge an SSE refresh. */
  pulsing?: boolean;
  onOpen?: (section: SectionData) => void;
}

export function SectionCard({ section, pulsing, onOpen }: Props) {
  const tooltip =
    section.score === null
      ? `${section.title}: not applicable for this project`
      : `Score = ${section.score}% (${section.band})`;

  return (
    <div
      className="flex flex-col rounded-lg border p-4 text-sm shadow-sm transition-colors"
      style={{
        background: 'var(--color-surface)',
        borderColor: pulsing ? 'var(--color-accent)' : 'var(--color-border)',
        color: 'var(--color-canvas-fg)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-semibold">{section.title}</div>
        <ScoreBadge score={section.score} band={section.band} title={tooltip} />
      </div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-h-[2.5em]" style={{ color: 'var(--color-muted)' }}>
          {section.summary}
        </div>
        {section.helper && (
          <HelperPopover what={section.helper.what} goodLooksLike={section.helper.goodLooksLike} />
        )}
      </div>
      {section.metrics.length > 0 && (
        <>
          <div className="my-3 border-t" style={{ borderColor: 'var(--color-border)' }} />
          <ul
            className="flex flex-wrap gap-x-3 gap-y-1 text-xs"
            style={{ color: 'var(--color-muted)' }}
          >
            {section.metrics.map((m) => (
              <li key={m.label}>
                <span className="opacity-70">{m.label}: </span>
                <span style={{ color: 'var(--color-canvas-fg)' }}>{m.value}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {onOpen && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="text-xs"
            style={{ color: 'var(--color-accent)' }}
            onClick={() => onOpen(section)}
          >
            Open →
          </button>
        </div>
      )}
    </div>
  );
}
