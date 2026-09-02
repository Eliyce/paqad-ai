/**
 * Pure logic for the Site map full-screen mode and the readable zoom floor (S7, D8). graph-ui is
 * build-gated — only pure lib logic is unit-tested — so the full-screen state machine and the
 * zoom-floor decision live here as branch-testable functions, and the React components in
 * SiteMapView.tsx / SiteMapCanvas.tsx / DashboardChrome.tsx stay thin wiring that `vite build`
 * verifies. Nothing here reads the DOM or persists anything: the full-screen preference is
 * deliberately never stored, so a page load can never open trapped in full screen (FR-7).
 */

/** The canvas zoom floor. Raised from 0.05: at 5% a surface card is an unreadable speck (FR-4). */
export const SITE_MAP_MIN_ZOOM = 0.25;

/** How full screen was entered: the browser Fullscreen API, or the CSS fixed-container fallback. */
export type FullscreenMethod = 'api' | 'css';

/** What a key press should do to the full-screen state. */
export type FullscreenKeyAction = 'toggle' | 'exit' | 'none';

/**
 * Map a key press to a full-screen action (FR-1). `f` toggles; `Escape` exits, but only while full
 * screen is active (otherwise it belongs to whatever else is open, e.g. the search box). Every key
 * is ignored while the user is typing in a text field, so the shortcut never eats a keystroke.
 */
export function fullscreenKeyAction(
  key: string,
  opts: { active: boolean; editable: boolean },
): FullscreenKeyAction {
  if (opts.editable) return 'none';
  if (key === 'f' || key === 'F') return 'toggle';
  if (key === 'Escape') return opts.active ? 'exit' : 'none';
  return 'none';
}

/**
 * Decide how to enter full screen (FR-3). The Fullscreen API is preferred, but the dashboard may be
 * embedded where the call is blocked, so a rejected call — or an absent API — falls back to the CSS
 * fixed-container. Both paths hide the same chrome; only the container styling differs.
 */
export function resolveFullscreenMethod(hasApi: boolean, apiRejected: boolean): FullscreenMethod {
  if (!hasApi) return 'css';
  return apiRejected ? 'css' : 'api';
}

/** Which of the four chrome pieces are visible. In full screen they hide together (FR-2, INV-2). */
export interface ChromeVisibility {
  sidebar: boolean;
  titleBand: boolean;
  honestyStrip: boolean;
  journeyBand: boolean;
}

/**
 * The visibility of the four chrome pieces for a given full-screen state (FR-2). All four show when
 * windowed and hide when full screen — there is no in-between, so the map genuinely gets the whole
 * window.
 */
export function chromeVisibility(fullscreen: boolean): ChromeVisibility {
  const visible = !fullscreen;
  return {
    sidebar: visible,
    titleBand: visible,
    honestyStrip: visible,
    journeyBand: visible,
  };
}

/**
 * Whether the map is larger than the window can show at the zoom floor (FR-5). A fit-to-view clamps
 * its target zoom to `[minZoom, maxZoom]`; when the fitted zoom lands at (or, within float error,
 * just above) the floor, the whole map could not be framed, so the over-size hint is shown. Above
 * the floor the map fits and no hint appears.
 */
export function isMapOversized(fittedZoom: number, minZoom: number, epsilon = 1e-3): boolean {
  return fittedZoom <= minZoom + epsilon;
}

/**
 * The enter/exit transition duration in milliseconds, honouring `prefers-reduced-motion` (FR-6):
 * zero — no animation — under reduced motion, a short fade otherwise.
 */
export function fullscreenTransitionMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 200;
}
