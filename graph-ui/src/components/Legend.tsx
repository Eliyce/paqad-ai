import { useMemo } from 'react';
import { computeOverlayMetrics, legendForOverlay } from '../lib/overlay';
import { useAppStore } from '../lib/store';

export function Legend() {
  const overlay = useAppStore((s) => s.overlay);
  const graph = useAppStore((s) => s.graph);

  const legend = useMemo(() => {
    if (!graph || overlay === 'none') return null;
    const metrics = computeOverlayMetrics(graph);
    return legendForOverlay(overlay, metrics);
  }, [overlay, graph]);

  if (!legend) return null;

  return (
    <div
      className="absolute bottom-3 left-3 rounded-lg border p-2 text-xs shadow-sm"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <div className="font-medium">{legend.title}</div>
      <ul className="mt-1 space-y-0.5">
        {legend.stops.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: s.color, borderColor: 'var(--color-border)' }}
            />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
