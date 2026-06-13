import { useState } from 'react';
import { fetchSimilar } from '../lib/api';
import type { OverlayKind } from '../lib/overlay';
import { useAppStore, type LayerVisibility } from '../lib/store';

import { SavedViewsBar } from './SavedViewsBar';

const LAYER_LABELS: { key: keyof LayerVisibility; label: string }[] = [
  { key: 'modules', label: 'Modules' },
  { key: 'files', label: 'Files' },
  { key: 'chunks', label: 'Chunks' },
  { key: 'symbols', label: 'Symbols' },
  { key: 'contains', label: 'Contains edges' },
  { key: 'imports', label: 'Imports edges' },
  { key: 'similar', label: 'Similarity edges' },
];

export function Sidebar() {
  const graph = useAppStore((s) => s.graph);
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const setLayers = useAppStore((s) => s.setLayers);
  const similarity = useAppStore((s) => s.similarity);
  const setSimilarityThreshold = useAppStore((s) => s.setSimilarityThreshold);
  const setSimilarityLoading = useAppStore((s) => s.setSimilarityLoading);
  const setSimilarityResult = useAppStore((s) => s.setSimilarityResult);
  const setSimilarityError = useAppStore((s) => s.setSimilarityError);
  const [pending, setPending] = useState<number>(similarity.threshold);
  const similarityAvailable = graph?.meta.similarity_edges_available ?? false;
  const overlay = useAppStore((s) => s.overlay);
  const setOverlay = useAppStore((s) => s.setOverlay);
  const overlaysAvailable = graph?.meta.overlays_available;
  const OVERLAY_OPTIONS: {
    key: OverlayKind;
    label: string;
    availableKey?: keyof NonNullable<typeof overlaysAvailable>;
  }[] = [
    { key: 'none', label: 'none' },
    { key: 'health', label: 'health', availableKey: 'health' },
    { key: 'defects', label: 'defect density', availableKey: 'defects' },
    { key: 'risk', label: 'risk floor', availableKey: 'risk_floor' },
    { key: 'complexity', label: 'complexity correction', availableKey: 'complexity_correction' },
  ];

  async function runSimilar(threshold: number) {
    setSimilarityThreshold(threshold);
    setSimilarityLoading(true);
    try {
      const r = await fetchSimilar({ threshold, scope: { type: 'all', id: null } });
      setSimilarityResult(r.edges as never, r.capped);
    } catch (err) {
      setSimilarityError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <aside
      className="absolute left-3 top-3 w-72 max-h-[calc(100vh-1.5rem)] overflow-auto rounded-lg border p-3 text-sm shadow-sm"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <header className="flex items-center justify-between">
        <h1 className="font-semibold tracking-tight">Graph</h1>
      </header>

      {graph && (
        <>
          <p className="mt-2 text-xs" style={{ color: 'var(--color-muted)' }}>
            {graph.meta.counts.modules} {graph.meta.counts.modules === 1 ? 'area' : 'areas'},
            coloured by health. Zoom in to see the files inside each one.
          </p>

          <details className="mt-3 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
            <summary
              className="cursor-pointer text-xs font-medium uppercase tracking-wide"
              style={{ color: 'var(--color-muted)' }}
            >
              Advanced / for engineers
            </summary>

            <section
              className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs"
              style={{ color: 'var(--color-muted)' }}
            >
              <div>modules</div>
              <div className="text-right">{graph.meta.counts.modules}</div>
              <div>files</div>
              <div className="text-right">{graph.meta.counts.files}</div>
              <div>chunks</div>
              <div className="text-right">{graph.meta.counts.chunks}</div>
              <div>symbols</div>
              <div className="text-right">{graph.meta.counts.symbols}</div>
              <div>imports</div>
              <div className="text-right">{graph.meta.counts.imports}</div>
            </section>

            <section className="mt-3 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
              <h2
                className="text-xs font-medium uppercase tracking-wide"
                style={{ color: 'var(--color-muted)' }}
              >
                Layers
              </h2>
              <ul className="mt-1 space-y-1">
                {LAYER_LABELS.map((l) => (
                  <li key={l.key} className="flex items-center gap-2">
                    <input
                      id={'layer-' + l.key}
                      type="checkbox"
                      checked={layers[l.key]}
                      onChange={() => toggleLayer(l.key)}
                    />
                    <label htmlFor={'layer-' + l.key}>{l.label}</label>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-3 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
              <h2
                className="text-xs font-medium uppercase tracking-wide"
                style={{ color: 'var(--color-muted)' }}
              >
                Overlay
              </h2>
              <select
                value={overlay}
                onChange={(e) => setOverlay(e.target.value as OverlayKind)}
                className="mt-1 w-full rounded border px-1.5 py-0.5 text-xs"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                {OVERLAY_OPTIONS.map((o) => {
                  const disabled =
                    o.availableKey != null &&
                    overlaysAvailable != null &&
                    !overlaysAvailable[o.availableKey];
                  return (
                    <option key={o.key} value={o.key} disabled={disabled}>
                      {o.label}
                      {disabled ? ' (unavailable)' : ''}
                    </option>
                  );
                })}
              </select>
            </section>

            <section className="mt-3 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
              <h2
                className="text-xs font-medium uppercase tracking-wide"
                style={{ color: 'var(--color-muted)' }}
              >
                Similarity
              </h2>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.01}
                  disabled={!similarityAvailable}
                  value={pending}
                  onChange={(e) => setPending(parseFloat(e.target.value))}
                  onMouseUp={(e) => runSimilar(parseFloat((e.target as HTMLInputElement).value))}
                  onKeyUp={(e) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                      runSimilar(parseFloat((e.target as HTMLInputElement).value));
                    }
                  }}
                  className="flex-1"
                />
                <span
                  className="w-10 text-right text-xs tabular-nums"
                  style={{ color: 'var(--color-muted)' }}
                >
                  {pending.toFixed(2)}
                </span>
              </div>
              <div className="mt-1 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                {!similarityAvailable
                  ? 'vector store missing — similarity disabled'
                  : similarity.loading
                    ? 'resolving…'
                    : similarity.error
                      ? `error: ${similarity.error}`
                      : `${similarity.edges.length} edges${similarity.capped ? ' (capped)' : ''}`}
              </div>
            </section>
          </details>

          {graph.meta.degraded_reasons.length > 0 && (
            <section className="mt-3 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
              <h2
                className="text-xs font-medium uppercase tracking-wide"
                style={{ color: 'var(--color-muted)' }}
              >
                Notes
              </h2>
              <ul
                className="mt-1 list-disc space-y-1 pl-4 text-xs"
                style={{ color: 'var(--color-muted)' }}
              >
                {graph.meta.degraded_reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-3 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
            <SavedViewsBar
              area="graph"
              getScope={() => ({
                layers,
                threshold: similarity.threshold,
                overlay,
              })}
              onApply={(scope) => {
                const s = scope as {
                  layers?: LayerVisibility;
                  threshold?: number;
                  overlay?: OverlayKind;
                };
                if (s.layers) setLayers(s.layers);
                if (typeof s.overlay === 'string') setOverlay(s.overlay);
                if (typeof s.threshold === 'number') {
                  setPending(s.threshold);
                  void runSimilar(s.threshold);
                }
              }}
            />
          </section>
        </>
      )}
    </aside>
  );
}
