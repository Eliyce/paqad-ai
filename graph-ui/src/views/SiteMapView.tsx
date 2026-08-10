import { useCallback, useEffect, useMemo, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { OwnershipBadge } from '../components/OwnershipBadge';
import { WhySentence } from '../components/WhySentence';
import { SiteMapCanvas } from '../components/SiteMapCanvas';
import { SiteMapDetail } from '../components/SiteMapDetail';
import { SiteMapList } from '../components/SiteMapList';
import { fetchDashboard, fetchSiteMap } from '../lib/api';
import type { Journey, SiteMapView as SiteMapPayload, Surface } from '../lib/site-map-types';
import { KIND_LEGEND } from '../lib/site-map-vocab';

/**
 * The Site map area (issue #466). Its primary content is an interactive visual of the app, read
 * statically from the single canonical docs/site-map/ YML the server serves on /api/site-map/map
 * (no LLM at view time). Journeys are the hero: pick one and walk it station by station. A
 * text-first list toggle gives the same information without the diagram (A11Y-2).
 */

type ViewMode = 'map' | 'list';

function shapeGlyph(shape: string): string {
  if (shape === 'diamond') return '◇';
  if (shape === 'stadium') return '▢';
  if (shape === 'slanted') return '▱';
  return '▭';
}

export function SiteMapView() {
  const [payload, setPayload] = useState<SiteMapPayload | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<ViewMode>('map');

  const load = useCallback((): void => {
    fetchSiteMap()
      .then((next) => {
        setPayload(next);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
    fetchDashboard()
      .then((report) => {
        setProjectName(report.projectName);
        setFrameworkVersion(report.frameworkVersion);
      })
      .catch(() => {
        /* chrome metadata is best-effort; the map still renders */
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setSseLive(true));
    source.addEventListener('error', () => setSseLive(false));
    // Live reload: when the .paqad/docs artefacts change, refresh the map (FRESH-2).
    source.addEventListener('message', () => load());
    return () => source.close();
  }, [load]);

  const ready = payload?.status === 'ready' ? payload : null;
  const map = ready?.map ?? null;

  const activeJourney: Journey | null = useMemo(() => {
    if (ready === null || activeJourneyId === null) return null;
    return ready.journeys.find((journey) => journey.id === activeJourneyId) ?? null;
  }, [ready, activeJourneyId]);

  const selectedSurface: Surface | null = useMemo(() => {
    if (map === null || selectedId === null) return null;
    return map.surfaces.find((surface) => surface.id === selectedId) ?? null;
  }, [map, selectedId]);

  const pickJourney = useCallback((id: string | null): void => {
    setActiveJourneyId(id);
    setStep(0);
  }, []);

  // When walking a journey, keep the current station selected so its detail shows (JM-2).
  useEffect(() => {
    if (activeJourney === null) return;
    const surface = activeJourney.steps[step]?.surface;
    if (surface !== undefined) setSelectedId(surface);
  }, [activeJourney, step]);

  return (
    <DashboardChrome
      projectName={projectName}
      frameworkVersion={frameworkVersion}
      sseLive={sseLive}
    >
      <div className="flex h-full flex-col">
        <div className="border-b px-6 py-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <h1 className="text-page font-semibold">Site map</h1>
            <OwnershipBadge managedBy="shared" />
            {ready && (
              <span className="text-caption" style={{ color: 'var(--color-muted)' }}>
                {ready.map.surfaces.length} surfaces
                {ready.freshness.generated_from ? ` · from ${ready.freshness.generated_from}` : ''}
              </span>
            )}
            {ready && (
              <div
                className="ml-auto inline-flex overflow-hidden rounded-[8px] border"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <ModeButton active={mode === 'map'} onClick={() => setMode('map')}>
                  Map
                </ModeButton>
                <ModeButton active={mode === 'list'} onClick={() => setMode('list')}>
                  List
                </ModeButton>
              </div>
            )}
          </div>
          <WhySentence>
            How your app really behaves, as a picture you can explore: every screen, journey, and
            gate, each traceable to the code.
          </WhySentence>
        </div>

        {loadError && <Banner tone="red">Could not load the site map: {loadError}</Banner>}
        {payload === null && !loadError && <Banner tone="muted">Loading…</Banner>}
        {payload?.status === 'disabled' && (
          <Banner tone="muted">
            The site map is turned off. Enable the <code>site_map</code> feature to build and view
            it.
          </Banner>
        )}
        {payload?.status === 'empty' && (
          <div className="mx-auto mt-10 max-w-lg px-6 text-center">
            <div className="text-body font-medium">No site map yet</div>
            <p className="mt-2 text-secondary" style={{ color: 'var(--color-muted)' }}>
              The AI builds the map from your project's documentation and code, then this area draws
              it as a picture you can explore. Ask paqad to <strong>create the site map</strong> to
              get started.
            </p>
          </div>
        )}

        {ready && map && (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Journey picker: journeys are the default unit (UXR-2). */}
            <div
              className="flex flex-wrap items-center gap-2 border-b px-6 py-2.5"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <span className="text-caption font-medium" style={{ color: 'var(--color-muted)' }}>
                Journey
              </span>
              <JourneyChip active={activeJourneyId === null} onClick={() => pickJourney(null)}>
                Whole map
              </JourneyChip>
              {ready.journeys.map((journey) => (
                <JourneyChip
                  key={journey.id}
                  active={activeJourneyId === journey.id}
                  onClick={() => pickJourney(journey.id)}
                >
                  {journey.label}
                </JourneyChip>
              ))}
              <div className="ml-auto flex items-center gap-2.5">
                {KIND_LEGEND.map((entry) => (
                  <span
                    key={entry.family}
                    className="inline-flex items-center gap-1 text-caption"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    <span aria-hidden="true">{shapeGlyph(entry.shape)}</span>
                    {entry.family}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="min-w-0 flex-1">
                {mode === 'map' ? (
                  <SiteMapCanvas
                    map={map}
                    activeJourney={activeJourney}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                ) : (
                  <SiteMapList map={map} selectedId={selectedId} onSelect={setSelectedId} />
                )}
              </div>
              {selectedSurface && (
                <SiteMapDetail
                  surface={selectedSurface}
                  map={map}
                  journeys={ready.journeys}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </div>

            {activeJourney && (
              <JourneyStepper journey={activeJourney} step={step} onStep={setStep} />
            )}
          </div>
        )}
      </div>
    </DashboardChrome>
  );
}

function JourneyStepper({
  journey,
  step,
  onStep,
}: {
  journey: Journey;
  step: number;
  onStep: (next: number) => void;
}) {
  const current = journey.steps[step];
  const total = journey.steps.length;
  return (
    <div
      className="flex items-center gap-3 border-t px-6 py-3"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <button
        type="button"
        disabled={step === 0}
        onClick={() => onStep(Math.max(0, step - 1))}
        className="rounded-[8px] px-3 py-1 text-caption font-medium disabled:opacity-40"
        style={{ border: '1px solid var(--color-border)' }}
      >
        ← Back
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-caption" style={{ color: 'var(--color-muted)' }}>
          Step {step + 1} of {total} · {journey.label}
        </div>
        <div className="truncate text-body">
          <strong>{current?.surface}</strong>
          {current?.action ? ` — ${current.action}` : ''}
          {current?.expect ? ` (expect: ${current.expect})` : ''}
        </div>
      </div>
      <button
        type="button"
        disabled={step >= total - 1}
        onClick={() => onStep(Math.min(total - 1, step + 1))}
        className="rounded-[8px] px-3 py-1 text-caption font-medium disabled:opacity-40"
        style={{ border: '1px solid var(--color-border)' }}
      >
        Next →
      </button>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1 text-caption font-medium"
      style={{
        background: active ? 'var(--color-accent)' : 'transparent',
        color: active ? '#ffffff' : 'var(--color-muted)',
      }}
    >
      {children}
    </button>
  );
}

function JourneyChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1 text-caption font-medium"
      style={{
        background: active ? 'var(--color-accent)' : 'var(--color-surface)',
        color: active ? '#ffffff' : 'var(--color-canvas-fg)',
        border: '1px solid var(--color-border)',
      }}
    >
      {children}
    </button>
  );
}

function Banner({ tone, children }: { tone: 'red' | 'muted'; children: React.ReactNode }) {
  return (
    <div
      className="mx-6 mt-4 rounded-[10px] border p-4 text-secondary"
      style={{
        background: 'var(--color-surface)',
        borderColor: tone === 'red' ? 'var(--color-mod-red)' : 'var(--color-border)',
        color: tone === 'muted' ? 'var(--color-muted)' : undefined,
      }}
    >
      {children}
    </div>
  );
}
