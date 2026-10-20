import { mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function shouldDebounce(
  markerPath: string,
  debounceMs: number,
  now: () => number = Date.now,
): boolean {
  if (debounceMs <= 0) {
    return false;
  }
  let mtimeMs: number;
  try {
    mtimeMs = statSync(markerPath).mtimeMs;
  } catch {
    return false;
  }
  return now() - mtimeMs < debounceMs;
}

export function touchMarker(markerPath: string, now: () => number = Date.now): void {
  try {
    mkdirSync(dirname(markerPath), { recursive: true });
  } catch {}
  const seconds = now() / 1000;
  try {
    utimesSync(markerPath, seconds, seconds);
  } catch {
    writeFileSync(markerPath, '');
    try {
      utimesSync(markerPath, seconds, seconds);
    } catch {}
  }
}
