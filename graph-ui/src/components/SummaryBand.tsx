import type { AttentionItem, ScoreBand } from '../lib/dashboard-types';

const BAND_TOKEN: Record<ScoreBand, string> = {
  green: 'var(--color-mod-green)',
  amber: 'var(--color-mod-amber)',
  red: 'var(--color-mod-red)',
  unknown: 'var(--color-mod-unknown)',
};

const BAND_HEADLINE: Record<ScoreBand, string> = {
  green: 'All good',
  amber: 'Needs your attention',
  red: 'Needs your attention',
  unknown: 'Not configured yet',
};

interface Props {
  score: number | null;
  band: ScoreBand;
  attention: AttentionItem[];
}

export function SummaryBand({ score, band, attention }: Props) {
  const value = score === null ? '—' : `${score}%`;
  const filled = score === null ? 0 : score;
  return (
    <div
      className="sticky top-0 z-10 flex flex-col gap-3 border-b px-6 py-4 backdrop-blur"
      style={{
        background: 'color-mix(in oklab, var(--color-canvas) 90%, transparent)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-3">
          <div className="text-3xl font-semibold" style={{ color: BAND_TOKEN[band] }}>
            {value}
          </div>
          <div className="text-sm uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
            Overall
          </div>
        </div>
        <div className="text-base font-medium">{BAND_HEADLINE[band]}</div>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--color-border)' }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${filled}%`, background: BAND_TOKEN[band] }}
        />
      </div>
      {attention.length > 0 && (
        <ul className="grid gap-1 text-xs" style={{ color: 'var(--color-canvas-fg)' }}>
          {attention.map((item, idx) => (
            <li key={`${item.sectionId}-${idx}`}>
              <span
                className="mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                style={{
                  background:
                    item.severity === 'critical'
                      ? 'var(--color-mod-red)'
                      : item.severity === 'warn'
                        ? 'var(--color-mod-amber)'
                        : 'var(--color-mod-unknown)',
                  color: 'white',
                }}
              >
                {item.severity}
              </span>
              {item.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
