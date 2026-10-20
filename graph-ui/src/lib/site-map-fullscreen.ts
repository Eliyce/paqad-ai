export const SITE_MAP_MIN_ZOOM = 0.25;

export type FullscreenMethod = 'api' | 'css';

export type FullscreenKeyAction = 'toggle' | 'exit' | 'none';

export function fullscreenKeyAction(
  key: string,
  opts: { active: boolean; editable: boolean },
): FullscreenKeyAction {
  if (opts.editable) return 'none';
  if (key === 'f' || key === 'F') return 'toggle';
  if (key === 'Escape') return opts.active ? 'exit' : 'none';
  return 'none';
}

export function resolveFullscreenMethod(hasApi: boolean, apiRejected: boolean): FullscreenMethod {
  if (!hasApi) return 'css';
  return apiRejected ? 'css' : 'api';
}

export interface ChromeVisibility {
  sidebar: boolean;
  titleBand: boolean;
  honestyStrip: boolean;
  journeyBand: boolean;
}

export function chromeVisibility(fullscreen: boolean): ChromeVisibility {
  const visible = !fullscreen;
  return {
    sidebar: visible,
    titleBand: visible,
    honestyStrip: visible,
    journeyBand: visible,
  };
}

export function isMapOversized(fittedZoom: number, minZoom: number, epsilon = 1e-3): boolean {
  return fittedZoom <= minZoom + epsilon;
}

export function fullscreenTransitionMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 200;
}
