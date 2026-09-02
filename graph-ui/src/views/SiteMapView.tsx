import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DashboardChrome } from '../components/DashboardChrome';
import { OpButton } from '../components/OpButton';
import { OwnershipBadge } from '../components/OwnershipBadge';
import { WhySentence } from '../components/WhySentence';
import { SiteMapCanvas } from '../components/SiteMapCanvas';
import { SiteMapDetail } from '../components/SiteMapDetail';
import { SiteMapList } from '../components/SiteMapList';
import {
  fetchDashboard,
  fetchSiteMap,
  fetchSiteMapProgress,
  resetSiteMapLayout,
  saveSiteMapLayout,
} from '../lib/api';
import { brokenJourneyRefs, danglingTargets, deadSurfaceIds } from '../lib/site-map-derive';
import {
  chromeVisibility,
  fullscreenKeyAction,
  fullscreenTransitionMs,
  resolveFullscreenMethod,
  type FullscreenMethod,
} from '../lib/site-map-fullscreen';
import {
  summarizeSiteMapProgress,
  type SiteMapProgressFile,
  type SiteMapProgressStrip,
} from '../lib/site-map-progress';
import type {
  AppMap,
  Journey,
  SiteMapFreshness,
  SiteMapView as SiteMapPayload,
  Surface,
} from '../lib/site-map-types';
import {
  freshnessVerdict,
  KIND_LEGEND,
  trustRollup,
  type FreshnessTone,
} from '../lib/site-map-vocab';

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
  const [progress, setProgress] = useState<SiteMapProgressFile | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [frameworkVersion, setFrameworkVersion] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<ViewMode>('map');
  // Full screen (S7, D8). Deliberately not persisted (FR-7): a page load never opens in full screen.
  // `method` records how we entered so the CSS fallback can style a fixed overlay and the native
  // path can be exited cleanly.
  const [fullscreen, setFullscreen] = useState(false);
  const [fsMethod, setFsMethod] = useState<FullscreenMethod | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );
  const chrome = chromeVisibility(fullscreen);

  const enterFullscreen = useCallback((): void => {
    const el = shellRef.current;
    const request = el?.requestFullscreen?.bind(el);
    const apply = (method: FullscreenMethod): void => {
      setFsMethod(method);
      setFullscreen(true);
    };
    if (request) {
      request()
        .then(() => apply(resolveFullscreenMethod(true, false)))
        .catch(() => apply(resolveFullscreenMethod(true, true)));
    } else {
      // No Fullscreen API (older or embedded host): the CSS fixed-container fallback (FR-3).
      apply(resolveFullscreenMethod(false, false));
    }
  }, []);

  const exitFullscreen = useCallback((): void => {
    if (document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => {
        /* already out of native full screen; the state below still clears */
      });
    }
    setFsMethod(null);
    setFullscreen(false);
  }, []);

  const toggleFullscreen = useCallback((): void => {
    if (fullscreen) exitFullscreen();
    else enterFullscreen();
  }, [fullscreen, enterFullscreen, exitFullscreen]);

  // Keyboard: `f` toggles, `Escape` exits — but never while the user is typing (FR-1).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const editable =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const action = fullscreenKeyAction(event.key, { active: fullscreen, editable });
      if (action === 'none') return;
      event.preventDefault();
      if (action === 'toggle') toggleFullscreen();
      else exitFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, toggleFullscreen, exitFullscreen]);

  // When the user leaves native full screen by the browser's own control, sync our state (FR-3).
  useEffect(() => {
    const onChange = (): void => {
      if (!document.fullscreenElement && fsMethod === 'api') {
        setFsMethod(null);
        setFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [fsMethod]);

  // A monotonically ticking focus request: selecting a gap/insight target flies the camera to it.
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const focusOn = useCallback((id: string): void => {
    setSelectedId(id);
    setFocus((prev) => ({ id, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

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
    // The resumable run progress (S6): null when no run has recorded any yet, so the strip stays
    // hidden until there is real progress to show.
    fetchSiteMapProgress()
      .then(setProgress)
      .catch(() => setProgress(null));
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

  // The map's real gaps, computed from the payload (no LLM): dead surfaces, dangling transition
  // targets, and journey steps referencing an unknown surface. Drives the insight line and chip.
  const gaps = useMemo(() => {
    if (map === null) return { dead: [] as string[], dangling: [], broken: [] };
    return {
      dead: [...deadSurfaceIds(map)],
      dangling: danglingTargets(map),
      broken: brokenJourneyRefs(map, ready?.journeys ?? []),
    };
  }, [map, ready]);
  const gapCount = gaps.dead.length + gaps.dangling.length + gaps.broken.length;

  // The run-progress strip's fields, or null when there is no progress file (S6): render nothing
  // rather than an empty bar.
  const progressStrip = useMemo(() => summarizeSiteMapProgress(progress), [progress]);

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
      hideSidebar={fullscreen}
    >
      <div
        ref={shellRef}
        className="flex h-full flex-col"
        style={
          // In the CSS fallback (embedded / API rejected) a fixed, full-viewport container gives the
          // map the whole window (FR-3); the native path already fills the screen. The transition
          // honours prefers-reduced-motion (FR-6).
          fullscreen && fsMethod === 'css'
            ? {
                position: 'fixed',
                inset: 0,
                zIndex: 50,
                background: 'var(--color-canvas)',
                transition: `opacity ${fullscreenTransitionMs(reducedMotion)}ms ease`,
              }
            : undefined
        }
      >
        {chrome.titleBand && (
          <div className="border-b px-6 py-4" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <h1 className="text-page font-semibold">Site map</h1>
              <OwnershipBadge managedBy="shared" />
              {ready && (
                <span className="text-caption" style={{ color: 'var(--color-muted)' }}>
                  {ready.map.surfaces.length} surfaces
                  {ready.freshness.generated_from
                    ? ` · from ${ready.freshness.generated_from}`
                    : ''}
                </span>
              )}
              <div className="ml-auto flex items-center gap-3">
                {/* Reuse the shared ops button (SSE progress + poll backstop) to run the map from
                    here; finishing reloads the view and the progress strip (S6, D8). */}
                <OpButton action="site-map" label="Run site map" onDone={load} />
                {ready && (
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    title="Full screen (press f, Escape to exit)"
                    className="rounded-[8px] px-3 py-1 text-caption font-medium"
                    style={{
                      background: 'var(--color-surface)',
                      color: 'var(--color-canvas-fg)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    Full screen
                  </button>
                )}
                {ready && (
                  <div
                    className="inline-flex overflow-hidden rounded-[8px] border"
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
            </div>
            <WhySentence>
              How your app really behaves, as a picture you can explore: every screen, journey, and
              gate, each traceable to the code.
            </WhySentence>
          </div>
        )}

        {chrome.titleBand && progressStrip && <ProgressStrip model={progressStrip} />}

        {chrome.honestyStrip && ready && map && (
          <HonestyStrip freshness={ready.freshness} map={map} />
        )}

        {loadError && <Banner tone="red">Could not load the site map: {loadError}</Banner>}
        {payload === null && !loadError && <Banner tone="muted">Loading…</Banner>}
        {payload?.status === 'disabled' && (
          <Banner tone="muted">
            The site map is turned off. Enable the <code>site_map</code> feature to build and view
            it.
          </Banner>
        )}
        {payload?.status === 'blocked' && (
          <div className="mx-auto mt-10 max-w-lg px-6 text-center">
            <div className="text-body font-medium">Finish the documentation first</div>
            <p className="mt-2 text-secondary" style={{ color: 'var(--color-muted)' }}>
              The site map is the third step of the same documentation family, so it needs these
              done first:
            </p>
            <div className="mt-4 flex flex-col gap-3 text-left">
              {payload.missing.map((item) => (
                <div
                  key={item.workflow}
                  className="rounded-[10px] border p-4"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <div className="text-body font-medium">
                    Run <code>{item.workflow}</code>
                  </div>
                  <p className="mt-1 text-caption" style={{ color: 'var(--color-muted)' }}>
                    {item.reason}
                  </p>
                </div>
              ))}
            </div>
          </div>
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
            {/* Journey picker: journeys are the default unit (UXR-2). Hidden in full screen; the
                floating bar over the canvas carries the journeys and an exit control then (S7). */}
            {chrome.journeyBand && (
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
                  <span aria-hidden="true" style={{ color: 'var(--color-border)' }}>
                    |
                  </span>
                  <span className="text-caption" style={{ color: 'var(--color-muted)' }}>
                    Solid = proven · Dashed = inferred or unverified
                  </span>
                </div>
              </div>
            )}

            {mode === 'map' && gapCount > 0 && (
              <InsightBar
                map={map}
                gaps={gaps}
                gapCount={gapCount}
                onFocus={focusOn}
                onPickJourney={pickJourney}
              />
            )}

            <div className="flex min-h-0 flex-1">
              <div className="relative min-w-0 flex-1">
                {/* In full screen the chrome is gone, so a bar floats over the content with an
                    always-visible exit control and the journey picker (S7, FR-2). */}
                {fullscreen && (
                  <FullscreenBar
                    journeys={ready.journeys}
                    activeJourneyId={activeJourneyId}
                    onPick={pickJourney}
                    onExit={exitFullscreen}
                  />
                )}
                {mode === 'map' ? (
                  <SiteMapCanvas
                    map={map}
                    journeys={ready.journeys}
                    activeJourneyId={activeJourneyId}
                    walkStationId={
                      activeJourney ? (activeJourney.steps[step]?.surface ?? null) : null
                    }
                    selectedId={selectedId}
                    focus={focus}
                    stored={ready.layout ?? null}
                    readOnly={ready.readOnly ?? false}
                    onSelect={setSelectedId}
                    onPickJourney={pickJourney}
                    onPersistLayout={(districts) => {
                      void saveSiteMapLayout(districts).catch((err: unknown) =>
                        setLoadError(err instanceof Error ? err.message : String(err)),
                      );
                    }}
                    onResetLayout={() => {
                      void resetSiteMapLayout().catch((err: unknown) =>
                        setLoadError(err instanceof Error ? err.message : String(err)),
                      );
                    }}
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

interface Gaps {
  dead: string[];
  dangling: { from: string; to: string }[];
  broken: { journey: string; surface: string }[];
}

function surfaceLabel(map: AppMap, id: string): string {
  return map.surfaces.find((surface) => surface.id === id)?.label ?? id;
}

/**
 * The first-open insight line + gaps chip (issue #489, Phase 3). One true line computed from the
 * payload in priority order (dead surfaces first), and a chip that opens the full gap list; each
 * row flies the camera to its node. Hidden entirely when the map has no gaps (the caller gates it).
 */
function InsightBar({
  map,
  gaps,
  gapCount,
  onFocus,
  onPickJourney,
}: {
  map: AppMap;
  gaps: Gaps;
  gapCount: number;
  onFocus: (id: string) => void;
  onPickJourney: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const insight =
    gaps.dead.length > 0
      ? `${gaps.dead.length} surface${gaps.dead.length === 1 ? '' : 's'} look dead: no entry, no connections.`
      : gaps.broken.length > 0
        ? `${gaps.broken.length} journey step${gaps.broken.length === 1 ? '' : 's'} point to a surface that isn't on the map.`
        : `${gaps.dangling.length} transition${gaps.dangling.length === 1 ? '' : 's'} point to a surface that isn't on the map.`;
  const firstFocus = gaps.dead[0] ?? gaps.dangling[0]?.from ?? map.surfaces[0]?.id ?? null;
  return (
    <div
      className="relative flex items-center gap-3 border-b px-6 py-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-canvas)' }}
    >
      <button
        type="button"
        onClick={() => firstFocus !== null && onFocus(firstFocus)}
        className="truncate text-left text-caption"
        style={{ color: 'var(--color-canvas-fg)' }}
      >
        <span aria-hidden="true" style={{ color: 'var(--color-mod-amber)' }}>
          ▲
        </span>{' '}
        {insight}
      </button>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="ml-auto rounded-full px-2.5 py-0.5 text-caption font-medium"
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-muted)',
        }}
      >
        {gapCount} gap{gapCount === 1 ? '' : 's'}
      </button>
      {open && (
        <div
          className="absolute right-6 top-full z-20 mt-1 w-96 max-w-[92vw] overflow-hidden rounded-[10px] border"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
        >
          <div className="max-h-72 overflow-y-auto py-1">
            {gaps.dead.map((id) => (
              <GapRow
                key={`dead:${id}`}
                tag="DEAD"
                text={surfaceLabel(map, id)}
                onClick={() => {
                  onFocus(id);
                  setOpen(false);
                }}
              />
            ))}
            {gaps.dangling.map((edge) => (
              <GapRow
                key={`dangling:${edge.from}->${edge.to}`}
                tag="DANGLING"
                text={`${surfaceLabel(map, edge.from)} → ${edge.to}`}
                onClick={() => {
                  onFocus(edge.from);
                  setOpen(false);
                }}
              />
            ))}
            {gaps.broken.map((ref) => (
              <GapRow
                key={`broken:${ref.journey}:${ref.surface}`}
                tag="BROKEN"
                text={`${ref.journey} → ${ref.surface}`}
                onClick={() => {
                  onPickJourney(ref.journey);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GapRow({ tag, text, onClick }: { tag: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-caption hover:opacity-80"
    >
      <span style={{ color: 'var(--color-muted)', fontSize: 10, letterSpacing: 0.4 }}>{tag}</span>
      <span className="truncate" style={{ color: 'var(--color-canvas-fg)' }}>
        {text}
      </span>
    </button>
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

/**
 * The floating full-screen bar (S7, FR-2). In full screen the four chrome pieces are gone, so this
 * one bar floats over the canvas carrying the journey picker and an always-visible exit control. The
 * canvas's own controls (zoom, minimap, wheel toggle) keep floating from the canvas itself.
 */
function FullscreenBar({
  journeys,
  activeJourneyId,
  onPick,
  onExit,
}: {
  journeys: Journey[];
  activeJourneyId: string | null;
  onPick: (id: string | null) => void;
  onExit: () => void;
}) {
  return (
    <div
      className="absolute left-1/2 top-3 z-20 flex max-w-[92%] -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-[10px] border px-3 py-1.5"
      style={{
        background: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
      }}
    >
      <button
        type="button"
        onClick={onExit}
        title="Exit full screen (Escape)"
        className="shrink-0 rounded-[8px] px-3 py-1 text-caption font-medium"
        style={{
          background: 'var(--color-canvas)',
          color: 'var(--color-canvas-fg)',
          border: '1px solid var(--color-border)',
        }}
      >
        Exit full screen
      </button>
      <span aria-hidden="true" style={{ color: 'var(--color-border)' }}>
        |
      </span>
      <JourneyChip active={activeJourneyId === null} onClick={() => onPick(null)}>
        Whole map
      </JourneyChip>
      {journeys.map((journey) => (
        <JourneyChip
          key={journey.id}
          active={activeJourneyId === journey.id}
          onClick={() => onPick(journey.id)}
        >
          {journey.label}
        </JourneyChip>
      ))}
    </div>
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

/** The colour token for a freshness tone. Colour reinforces the glyph and word, never carries the
 *  meaning on its own (A11Y-3). */
function toneColor(tone: FreshnessTone): string {
  if (tone === 'fresh') return 'var(--color-mod-green)';
  if (tone === 'stale') return 'var(--color-mod-amber)';
  return 'var(--color-mod-unknown)';
}

/**
 * The run-progress strip (S6, D8). While a run authors the map it shows how far along it is: the
 * current unit, a done / writing / remaining count, and one line naming what a previous session
 * already finished. Read statically from the served progress file; the caller renders it only when
 * a progress file exists, so it never shows an empty or zeroed bar.
 */
function ProgressStrip({ model }: { model: SiteMapProgressStrip }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-6 py-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-canvas)' }}
    >
      <span
        className="inline-flex items-center gap-1.5 text-caption font-medium"
        style={{ color: 'var(--color-canvas-fg)' }}
      >
        <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>
          ●
        </span>
        {model.current}
      </span>
      <span className="text-caption" style={{ color: 'var(--color-muted)' }}>
        <strong style={{ color: 'var(--color-canvas-fg)' }}>{model.done}</strong> done ·{' '}
        {model.writing} writing · {model.remaining} to go
      </span>
      {model.skipped && (
        <span className="ml-auto text-caption" style={{ color: 'var(--color-muted)' }}>
          {model.skipped}
        </span>
      )}
    </div>
  );
}

/**
 * The honesty strip (issue #466, C5c). It surfaces the proof layer the map already carries: how
 * fresh the map is versus the code it cites, and how much of it is proven in code rather than
 * inferred. Both are read statically from the served payload, so nothing resolves at view time
 * (NFR-1). It never claims more certainty than the elements earned (FR-3).
 */
function HonestyStrip({ freshness, map }: { freshness: SiteMapFreshness; map: AppMap }) {
  const verdict = freshnessVerdict(freshness);
  const trust = trustRollup(map);
  const color = toneColor(verdict.tone);
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-6 py-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <span className="inline-flex items-center gap-1.5 text-caption font-medium" style={{ color }}>
        <span aria-hidden="true">{verdict.glyph}</span>
        {verdict.label}
      </span>
      <span className="text-caption" style={{ color: 'var(--color-muted)' }}>
        {verdict.detail}
      </span>
      <span className="ml-auto text-caption" style={{ color: 'var(--color-muted)' }}>
        <strong style={{ color: 'var(--color-canvas-fg)' }}>
          {trust.proven} of {trust.total}
        </strong>{' '}
        surfaces proven in code or stronger
        {trust.unproven > 0 ? ` · ${trust.unproven} still inferred or unverified` : ''}
      </span>
    </div>
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
