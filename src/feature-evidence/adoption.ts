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
//   - when the session has no active feature and EXACTLY ONE in-flight bundle belongs to
//     the current branch, that bundle is adopted as active.
//
// "In flight" reuses signals that already exist rather than inventing state: a bundle is
// in flight when its `stage-evidence.jsonl` has real rows and carries no `kind:'close'`
// row — the row the finalizer writes when a change passes verification (issue #321).
//
// That alone is nowhere near specific enough, which is the trap this module fell into
// first: a change that was abandoned, or shipped without a passing verdict, never gets a
// close row either, so a real repo accumulates in-flight bundles indefinitely (this one
// held 13). With all of them candidates, "exactly one" never held and adoption never
// ran. The BRANCH is the scope that makes it precise (decision
// D-01KXY55ZM70Y3JNDM8E0XC7WSX): a session id rotates within a change, a branch does
// not, so the branch names the rotated session's own work — deterministically, with no
// clock heuristic and no tunable window. Adoption stays conservative on top of that: two
// or more in-flight bundles on one branch is ambiguous, so nothing is adopted and the
// caller mints, exactly as before.
//
// Nothing here MINTS. The reconcile only repoints a control at a bundle that already
// exists on disk, which is what keeps it safe to run from a read path.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readGitState } from '@/rag/git-state.js';
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
 * The branch a bundle belongs to: stamped on its `open` row (issue #404), falling back to
 * the branch `delivery.json` recorded once the change reached its first commit. `null`
 * when neither is known — a bundle opened before the stamp existed, or a change made off
 * a branch (detached HEAD, non-git project).
 */
export function featureBranch(
  projectRoot: string,
  dirName: string,
  rows = stageRows(projectRoot, dirName),
): string | null {
  for (const row of rows) {
    const branch = row.kind === 'open' ? row.branch : undefined;
    if (typeof branch === 'string' && branch.length > 0) {
      return branch;
    }
  }
  return deliveryBranch(projectRoot, dirName);
}

/**
 * The `branch` field of a bundle's `delivery.json`, or `null` when it has none.
 *
 * Read here rather than through `delivery.ts`'s `readFeatureDelivery`, which imports
 * `currentFeature` from the stage ledger and would close the cycle this module exists
 * outside of (adoption → delivery → stage-ledger → adoption). One field, read
 * tolerantly — not a second copy of the delivery record's shape or defaults.
 */
function deliveryBranch(projectRoot: string, dirName: string): string | null {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'delivery')), 'utf8'),
    );
    const branch = (raw as { branch?: unknown }).branch;
    return typeof branch === 'string' && branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

/**
 * Every materialized, unclosed bundle that belongs to `branch`, in dir-name order.
 *
 * Two filters, and the branch one is what makes this usable. The finalizer appends
 * `kind:'close'` when a change earns a passing verdict, so its absence is the existing
 * signal for "still open" — but on its own that signal is far too broad: a change that
 * was abandoned, or shipped without a passing verdict, never gets a close row either, so
 * a real repo accumulates them (this one held 13 when the branch scope was added). With
 * every one of those a candidate, the "exactly one" guard below could never fire and
 * adoption was dead code.
 *
 * The branch is the scope that makes it precise, and it is deterministic rather than a
 * clock heuristic: a session-id rotation happens WITHIN a change, and a change is built
 * on one branch, so the branch identifies the rotated session's own work. A bundle whose
 * branch is unknown is never adoptable on a branch — no evidence it belongs here.
 *
 * `branch` of `null` (detached HEAD, or a non-git project) means the scope cannot be
 * applied, and the unscoped in-flight set is returned as before.
 */
export function listAdoptableFeatures(projectRoot: string, branch: string | null): string[] {
  return listFeatureDirs(projectRoot).filter((dirName) => {
    const rows = stageRows(projectRoot, dirName);
    if (rows.length === 0 || rows.some((row) => row.kind === 'close')) {
      return false;
    }
    return branch === null || featureBranch(projectRoot, dirName, rows) === branch;
  });
}

/**
 * Every materialized bundle that has not been closed, across all branches. The honest
 * whole-project view; `listAdoptableFeatures` is what adoption actually consults.
 */
export function listInFlightFeatures(projectRoot: string): string[] {
  return listAdoptableFeatures(projectRoot, null);
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

  // Scoped to the current branch: a session id rotates mid-change, a branch does not, so
  // the branch is what tells this session's own in-flight bundle from every other open
  // one. A paused bundle is in flight too, but the session deliberately set it aside — a
  // detour must not silently resume it, so only bundles outside the stack are adopted.
  const branch = readGitState(projectRoot).branch ?? null;
  const candidates = listAdoptableFeatures(projectRoot, branch).filter(
    (name) => !control.paused.includes(name),
  );
  if (candidates.length !== 1) {
    return control.active;
  }

  const adopted = candidates[0]!;
  writeSessionControl(projectRoot, { ...control, active: adopted }, now);
  return adopted;
}
