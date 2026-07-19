// In-flight bundle adoption across a session-id rotation (issue #404).
//
// The active feature is tracked per session in `_session/<sessionId>.json`. When the
// host session id rotates mid-change — an app relaunch, a resumed conversation, an
// unset/rotated `SE_SESSION` — the new session reads a DIFFERENT control, finds no
// active feature, and mints a fresh `change-<ULID>`: the in-flight bundle is orphaned
// and the stages already recorded against it stop counting (the incident forced the
// agent to re-record `planning` by hand).
//
// This module is the carry-over. Before anything mints, a session's control is
// reconciled:
//   - a pointer naming a bundle dir that does not exist is dropped (it names no
//     evidence, so trusting it can only mis-attribute later rows), and
//   - when the session has no active feature and the project holds EXACTLY ONE
//     in-flight bundle, that bundle is adopted as active.
//
// "In-flight" reuses the signals that already exist rather than inventing state: a
// bundle is in flight when its `stage-evidence.jsonl` has real rows and carries no
// `kind:'close'` row — the row the finalizer writes when a change passes verification
// (issue #321). Adoption is deliberately conservative: two or more in-flight bundles is
// ambiguous, so nothing is adopted and the caller mints, exactly as before.
//
// Nothing here MINTS. The reconcile only repoints a control at a bundle that already
// exists on disk, which is what keeps it safe to run from a read path.

// Leaf imports only: `stage-ledger.ts` calls INTO this module, so reading its
// `readFeatureStageUnit` here would close a cycle. The underlying primitives
// (`readUnitFile` + the bundle path) are the same ones it wraps.
import { readUnitFile } from '@/session-ledger/ledger.js';

import { listFeatureDirs } from './enumerate.js';
import { featureFilePath } from './paths.js';
import { readSessionControl, writeSessionControl } from './session-control.js';

/** A bundle's stage rows, tolerant of an absent/unreadable bundle (reads as none). */
function stageRows(projectRoot: string, dirName: string) {
  return readUnitFile(projectRoot, featureFilePath(dirName, 'stageEvidence'));
}

/**
 * True when `dirName`'s bundle holds real stage evidence — the on-disk proof that the
 * bundle was actually materialized, not merely pointed at. A bundle dir is created by
 * the first row append, so a pointer at a rowless name is a dangling pointer.
 */
export function isBundleMaterialized(projectRoot: string, dirName: string): boolean {
  return stageRows(projectRoot, dirName).length > 0;
}

/**
 * Every materialized bundle that has not been closed, in dir-name order. The finalizer
 * appends `kind:'close'` when a change earns a passing verdict, so its absence is the
 * existing signal for "this change is still open".
 */
export function listInFlightFeatures(projectRoot: string): string[] {
  return listFeatureDirs(projectRoot).filter((dirName) => {
    const rows = stageRows(projectRoot, dirName);
    return rows.length > 0 && !rows.some((row) => row.kind === 'close');
  });
}

/**
 * Reconcile a session's control and return the feature it should be working on, or
 * `null` when there is none.
 *
 * Two repairs, in order:
 *   1. Drop every `active`/`paused` entry naming a bundle dir that does not exist. A
 *      dangling pointer names no evidence, so clearing it loses nothing and stops later
 *      rows from being attributed to a bundle that was never written.
 *   2. When no active feature survives and the project holds exactly one in-flight
 *      bundle, adopt it — this is the session-rotation carry-over. Two or more is
 *      ambiguous, so nothing is adopted.
 *
 * NEVER mints a feature: it only repoints the control at a bundle that already exists,
 * which is why the read paths (`currentFeature`) can safely call it. The control is
 * rewritten only when something actually changed, so a healthy session does no I/O
 * beyond the read.
 */
export function reconcileSessionControl(
  projectRoot: string,
  sessionId: string,
  now?: () => Date,
): string | null {
  const control = readSessionControl(projectRoot, sessionId, now);
  const materialized = (dirName: string): boolean => isBundleMaterialized(projectRoot, dirName);

  const paused = control.paused.filter(materialized);
  let active = control.active !== null && materialized(control.active) ? control.active : null;

  if (active === null) {
    // A paused bundle is in flight too, but the session deliberately set it aside — a
    // detour must not silently resume it, so only bundles outside the stack are adopted.
    const inFlight = listInFlightFeatures(projectRoot).filter((name) => !paused.includes(name));
    if (inFlight.length === 1) {
      active = inFlight[0]!;
    }
  }

  const changed = active !== control.active || paused.length !== control.paused.length;
  if (changed) {
    writeSessionControl(projectRoot, { ...control, active, paused }, now);
  }
  return active;
}
