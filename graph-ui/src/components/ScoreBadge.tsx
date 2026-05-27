import type { ScoreBand } from '../lib/dashboard-types';

const BAND_TOKEN: Record<ScoreBand, string> = {
  green: 'var(--color-mod-green)',
  amber: 'var(--color-mod-amber)',
  red: 'var(--color-mod-red)',
  unknown: 'var(--color-mod-unknown)',
};

interface Props {
  score: number | null;
  band: ScoreBand;
  /** Tooltip text. Per the brief, always shows the math. */
  title?: string;
}

export function ScoreBadge({ score, band, title }: Props) {
  const text = score === null ? '—' : `${score}%`;
  return (
    <span
      className="inline-flex select-none items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold text-white"
      style={{ background: BAND_TOKEN[band], minWidth: '2.5rem' }}
      title={title ?? `Score = ${text} (${band})`}
    >
      {text}
    </span>
  );
}
