import { describe, expect, it } from 'vitest';

import {
  chromeVisibility,
  fullscreenKeyAction,
  fullscreenTransitionMs,
  isMapOversized,
  resolveFullscreenMethod,
  SITE_MAP_MIN_ZOOM,
} from './site-map-fullscreen';

describe('fullscreenKeyAction (S7, FR-1)', () => {
  it('toggles on f/F', () => {
    expect(fullscreenKeyAction('f', { active: false, editable: false })).toBe('toggle');
    expect(fullscreenKeyAction('F', { active: true, editable: false })).toBe('toggle');
  });

  it('exits on Escape only while active', () => {
    expect(fullscreenKeyAction('Escape', { active: true, editable: false })).toBe('exit');
    expect(fullscreenKeyAction('Escape', { active: false, editable: false })).toBe('none');
  });

  it('ignores every key while the user is typing', () => {
    expect(fullscreenKeyAction('f', { active: false, editable: true })).toBe('none');
    expect(fullscreenKeyAction('Escape', { active: true, editable: true })).toBe('none');
  });

  it('ignores unmapped keys', () => {
    expect(fullscreenKeyAction('a', { active: true, editable: false })).toBe('none');
    expect(fullscreenKeyAction('Enter', { active: false, editable: false })).toBe('none');
  });
});

describe('resolveFullscreenMethod (S7, FR-3)', () => {
  it('uses the API when it is present and the call was accepted', () => {
    expect(resolveFullscreenMethod(true, false)).toBe('api');
  });

  it('falls back to CSS when the API call is rejected', () => {
    expect(resolveFullscreenMethod(true, true)).toBe('css');
  });

  it('falls back to CSS when the API is absent', () => {
    expect(resolveFullscreenMethod(false, false)).toBe('css');
    expect(resolveFullscreenMethod(false, true)).toBe('css');
  });
});

describe('chromeVisibility (S7, FR-2, INV-2, INV-3)', () => {
  it('shows all four chrome pieces when windowed', () => {
    expect(chromeVisibility(false)).toEqual({
      sidebar: true,
      titleBand: true,
      honestyStrip: true,
      journeyBand: true,
    });
  });

  it('hides all four chrome pieces together in full screen', () => {
    const visibility = chromeVisibility(true);
    expect(visibility).toEqual({
      sidebar: false,
      titleBand: false,
      honestyStrip: false,
      journeyBand: false,
    });
    // No in-between: every piece shares the one full-screen decision.
    expect(Object.values(visibility).every((shown) => shown === false)).toBe(true);
  });
});

describe('isMapOversized (S7, FR-5, INV-6)', () => {
  it('is true when the fit is clamped at the floor', () => {
    expect(isMapOversized(SITE_MAP_MIN_ZOOM, SITE_MAP_MIN_ZOOM)).toBe(true);
  });

  it('absorbs float error just above the floor', () => {
    expect(isMapOversized(SITE_MAP_MIN_ZOOM + 0.0005, SITE_MAP_MIN_ZOOM)).toBe(true);
  });

  it('is false when the map fits above the floor', () => {
    expect(isMapOversized(0.8, SITE_MAP_MIN_ZOOM)).toBe(false);
    expect(isMapOversized(SITE_MAP_MIN_ZOOM + 0.26, SITE_MAP_MIN_ZOOM)).toBe(false);
  });

  it('keeps the floor readable (well above the old 0.05)', () => {
    expect(SITE_MAP_MIN_ZOOM).toBe(0.25);
  });
});

describe('fullscreenTransitionMs (S7, FR-6, INV-7)', () => {
  it('is zero under reduced motion', () => {
    expect(fullscreenTransitionMs(true)).toBe(0);
  });

  it('is non-zero otherwise', () => {
    expect(fullscreenTransitionMs(false)).toBeGreaterThan(0);
  });
});
