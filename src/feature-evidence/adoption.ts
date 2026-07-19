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
 * The control is repointed at the single in-flight bundle when the session's own
 * `active` does not name real evidence — either because it is unset (the rotated-session
 * case: a fresh control) or because it names a bundle dir that was never materialized
 * (the dangling-pointer case). Two or more in-flight bundles is ambiguous, so nothing is
 * adopted and the caller mints exactly as before.
 *
 * REPOINT ONLY — a dangling pointer is never simply cleared (decision
 * D-01KXY2BDSN226DDCH9DZA1TAK6). `resolveActiveFeature` mints a feature and sets it
 * active BEFORE any row is appended, so a freshly minted pointer legitimately names an
 * unmaterialized dir until the first append lands; clearing it there would drop the
 * change the session just opened. With nothing to adopt, the existing pointer stands.
 *
 * NEVER mints a feature: every name it can return already holds stage evidence on disk,
 * which is why the read paths (`currentFeature`) can safely call it. The control is
 * rewritten only when the active pointer actually moves, so a healthy session does no
 * I/O beyond the read.
 */
export function reconcileSessionControl(
  projectRoot: string,
  sessionId: string,
  now?: () => Date,
): string | null {
  const control = readSessionControl(projectRoot, sessionId, now);
  if (control.active !== null && isBundleMaterialized(projectRoot, control.active)) {
    return control.active;
  }

  // A paused bundle is in flight too, but the session deliberately set it aside — a
  // detour must not silently resume it, so only bundles outside the stack are adopted.
  const inFlight = listInFlightFeatures(projectRoot).filter(
    (name) => !control.paused.includes(name),
  );
  if (inFlight.length !== 1) {
    return control.active;
  }

  const adopted = inFlight[0]!;
  writeSessionControl(projectRoot, { ...control, active: adopted }, now);
  return adopted;
}
