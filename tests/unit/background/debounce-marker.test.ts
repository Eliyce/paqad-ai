import { existsSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { shouldDebounce, touchMarker } from '@/background/debounce-marker.js';

import { withTempDir } from '../skills/_helpers/temp-fs.js';

describe('shouldDebounce', () => {
  it('is false on first run when the marker does not exist', () => {
    withTempDir((dir) => {
      expect(shouldDebounce(join(dir, 'm'), 1000)).toBe(false);
    });
  });

  it('is true while the last spawn is inside the window', () => {
    withTempDir((dir) => {
      const marker = join(dir, 'm');
      const stamp = 1_000_000; // seconds
      writeFileSync(marker, '');
      utimesSync(marker, stamp, stamp);
      // now = 500ms after the marker, window = 1000ms → still debounced.
      expect(shouldDebounce(marker, 1000, () => stamp * 1000 + 500)).toBe(true);
    });
  });

  it('is false once the window has elapsed', () => {
    withTempDir((dir) => {
      const marker = join(dir, 'm');
      const stamp = 1_000_000;
      writeFileSync(marker, '');
      utimesSync(marker, stamp, stamp);
      // now = 1500ms after the marker, window = 1000ms → no longer debounced.
      expect(shouldDebounce(marker, 1000, () => stamp * 1000 + 1500)).toBe(false);
    });
  });

  it('is false when debounce is disabled (window <= 0)', () => {
    withTempDir((dir) => {
      const marker = join(dir, 'm');
      writeFileSync(marker, '');
      expect(shouldDebounce(marker, 0)).toBe(false);
    });
  });
});

describe('touchMarker', () => {
  it('creates the marker (and parents) opening a fresh window', () => {
    withTempDir((dir) => {
      const marker = join(dir, 'sub', 'm');
      const stamp = 2_000_000;
      touchMarker(marker, () => stamp * 1000);
      expect(existsSync(marker)).toBe(true);
      // Immediately after touching, a same-instant check is debounced.
      expect(shouldDebounce(marker, 1000, () => stamp * 1000)).toBe(true);
    });
  });

  it('advances an existing marker to the new time without changing contents', () => {
    withTempDir((dir) => {
      const marker = join(dir, 'm');
      const stamp = 3_000_000;
      touchMarker(marker, () => stamp * 1000);
      // A later touch reopens the window relative to the new time.
      const later = stamp + 10;
      touchMarker(marker, () => later * 1000);
      expect(shouldDebounce(marker, 1000, () => later * 1000 + 500)).toBe(true);
      expect(shouldDebounce(marker, 1000, () => later * 1000 + 1500)).toBe(false);
    });
  });
});
