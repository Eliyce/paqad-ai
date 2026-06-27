import { mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Debounce marker: a tiny file whose mtime records when a job last spawned a
 * worker. A trigger arriving within `debounceMs` of that mtime is coalesced
 * away, so a burst of prompts (every keystroke-driven hook firing) produces at
 * most one background refresh per window.
 *
 * This is the cheap, leading-edge guard that runs BEFORE the single-flight lock
 * is even consulted: it suppresses re-spawns in the quiet moment just after a
 * worker finished, which the lock alone cannot do.
 */

/** True when the last spawn (marker mtime) is newer than `debounceMs` ago. */
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
    return false; // No marker yet — never debounced on first run.
  }
  return now() - mtimeMs < debounceMs;
}

/** Stamp the marker with the current time to open a fresh debounce window. */
export function touchMarker(markerPath: string, now: () => number = Date.now): void {
  try {
    mkdirSync(dirname(markerPath), { recursive: true });
  } catch {
    // Parent may already exist; the write below surfaces a real failure.
  }
  const seconds = now() / 1000;
  try {
    // Update the timestamp in place when the marker already exists so we don't
    // churn its contents; create it (with the same mtime) when it doesn't.
    utimesSync(markerPath, seconds, seconds);
  } catch {
    writeFileSync(markerPath, '');
    try {
      utimesSync(markerPath, seconds, seconds);
    } catch {
      // Best-effort: a filesystem that rejects utimes still has a fresh mtime
      // from the write above, which is good enough for debounce.
    }
  }
}
