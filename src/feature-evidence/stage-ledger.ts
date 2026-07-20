// Feature-scoped stage-evidence ledger (issue #339, Phase 2 — additive).
//
// The per-feature bundle keeps a change's stage evidence at
// `<feature-dir>/stage-evidence.jsonl` instead of the legacy
// `paqad.stage-evidence/<session>/<ordinal>.jsonl`. This module resolves the active
// feature for a session (Phase-1 `_session` control), mints one when none is active
// so a stage call never lands on nothing (mirrors the legacy auto-open), and
// reads / appends / folds a feature's stage rows — reusing the session-ledger row
// primitives (issue #339 2a) and the stage-evidence fold core. Additive/dark:
// nothing wires it into the live recorder yet; the cutover does that.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readGitState } from '@/rag/git-state.js';
import {
  appendStampedRowToUnit,
  readUnitFile,
  stampSessionRow,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';
import { augmentWithBundleArtifacts, foldRowsWithKey } from '@/stage-evidence/fold.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import {
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_SCHEMA_VERSION,
  type FoldedChange,
} from '@/stage-evidence/types.js';

import { reconcileSessionControl } from './adoption.js';
import { UNTITLED_FEATURE_TITLE, mintFeatureDirName } from './mint.js';
import { featureFilePath, parseFeatureDirName } from './paths.js';
import {
  markDone,
  readSessionControl,
  resumeFeature,
  setActiveFeature,
} from './session-control.js';
import type { FeatureLane } from './types.js';

export interface ResolveFeatureInput {
  /** Explicit feature title → mints a NEW named feature and switches to it. */
  title?: string;
  /** Ticket ref for a titled feature (verbatim, or null to force none). */
  issue?: string | null;
  lane?: FeatureLane;
  /** Deterministic ULID seam for tests. */
  ulid?: string;
  ulidSeed?: number;
  now?: () => Date;
}

/**
 * Resolve the active feature dir name for `sessionId`. An explicit `title` always
 * mints a NEW named feature and switches to it (the "new work" signal); with no title
 * it returns the active feature, or — when none is active — mints an untitled
 * `change-<ULID>` feature so a stage call never lands on nothing (mirrors the legacy
 * auto-open). The minted feature is set active in the `_session` control.
 *
 * The lookup goes through `reconcileSessionControl` (issue #404) rather than reading the
 * control raw, so a session-id rotation mid-change ADOPTS the in-flight bundle instead of
 * minting a second one and orphaning the first. A dangling pointer (a bundle dir that was
 * never materialized) is cleared by the same pass.
 */
export function resolveActiveFeature(
  projectRoot: string,
  sessionId: string,
  input: ResolveFeatureInput = {},
): string {
  if (input.title !== undefined) {
    return mintAndActivate(projectRoot, sessionId, input.title, input);
  }
  const active = reconcileSessionControl(projectRoot, sessionId, input.now);
  if (active) {
    return active;
  }
  return mintAndActivate(projectRoot, sessionId, UNTITLED_FEATURE_TITLE, input);
}

function mintAndActivate(
  projectRoot: string,
  sessionId: string,
  title: string,
  input: ResolveFeatureInput,
): string {
  const minted = mintFeatureDirName({
    title,
    issue: input.issue,
    ulid: input.ulid,
    ulidSeed: input.ulidSeed,
  });
  setActiveFeature(projectRoot, sessionId, minted.dirName, { lane: input.lane, now: input.now });
  return minted.dirName;
}

/** Project-relative path to a feature's stage-evidence ledger file. */
export function featureStagePath(dirName: string): string {
  return featureFilePath(dirName, 'stageEvidence');
}

/**
 * Append one stage-evidence row into the feature's bundle (stamped + validated by the
 * existing stage-evidence schema). `conversation_ordinal` is retired as the change key
 * (the feature dir name is the key now) but the row schema still carries it for
 * provenance/back-compat, so a constant `1` is stamped unless the caller overrides it.
 */
export function appendFeatureStageRow(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  row: Record<string, unknown>,
  now?: () => Date,
): SessionLedgerRow {
  const stamped = stampSessionRow(
    STAGE_EVIDENCE_DOC_TYPE,
    sessionId,
    { conversation_ordinal: 1, ...row },
    {
      schemaVersion: STAGE_EVIDENCE_SCHEMA_VERSION,
      validate: (r) => validateStageEvidenceRow(r),
      now,
    },
  );
  appendStampedRowToUnit(projectRoot, featureStagePath(dirName), stamped);
  return stamped;
}

/** Tolerant read of a feature's stage-evidence rows. */
export function readFeatureStageUnit(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureStagePath(dirName));
}

/** Fold a feature's stage rows into the per-change view, keyed by the dir name. */
export function foldFeature(projectRoot: string, sessionId: string, dirName: string): FoldedChange {
  const rows = readFeatureStageUnit(projectRoot, dirName);
  const fold = foldRowsWithKey(rows, { sessionId, changeKey: dirName, promptOrdinal: 0 });
  // Issue #394: a rigid thinking stage is truly done only when its bundle artifact
  // actually exists. Assert plan.json + specification.json are present and non-empty, so
  // a change whose rows read complete but never produced the artifacts (the incident's
  // hand-written `.paqad/features/…` free-write) cannot fold to complete.
  return augmentWithBundleArtifacts(fold, {
    plan: bundleFileNonEmpty(projectRoot, dirName, 'plan'),
    specification: bundleFileNonEmpty(projectRoot, dirName, 'specification'),
  });
}

/** True when a bundle file exists and has real bytes. A single read + catch (never
 *  stat-then-read) avoids the TOCTOU file-system race CodeQL flags (js/file-system-race);
 *  a missing/unreadable file reads as absent, which downgrades the verdict (issue #394). */
function bundleFileNonEmpty(
  projectRoot: string,
  dirName: string,
  file: 'plan' | 'specification',
): boolean {
  try {
    return readFileSync(join(projectRoot, featureFilePath(dirName, file))).length > 0;
  } catch {
    return false;
  }
}

/**
 * The active feature dir name for this session, or `null` when none is active. NEVER
 * MINTS, so a reader (the pre-mutation gate, the narrator, the finalizer) sees "no open
 * change" as `null` rather than accidentally creating a feature. The feature-dir analogue
 * of the legacy `currentOrdinal(...) > 0` probe.
 *
 * It resolves through `reconcileSessionControl` (issue #404), which may REPOINT the
 * session control at an in-flight bundle that already exists — so a session-id rotation
 * is carried over on the read paths too, not just when a stage mints. That is a write,
 * but never a mint: no bundle is created, and every name it can return already holds
 * stage evidence on disk. Without it the finalizer would read `null` after a rotation and
 * write its inferred-git backstop into a fresh bundle — forking the change a second time.
 */
export function currentFeature(projectRoot: string, sessionId: string): string | null {
  return reconcileSessionControl(projectRoot, sessionId);
}

export interface OpenFeatureChangeInput extends ResolveFeatureInput {
  adapter: string;
}

/**
 * Open (or resolve) the active feature for a change and guarantee its bundle carries a
 * single `kind:'open'` row stamping the lane — the feature-dir analogue of the legacy
 * `openSessionDoc`. A `title` mints a NEW named feature (the "new work" signal, pausing
 * any prior active); otherwise the active feature is reused, or an untitled
 * `change-<ULID>` is minted when none is active. The open row is written only when the
 * resolved bundle does not already have one, so re-opening an already-open change is a
 * no-op (idempotent) — never a duplicate open row. Returns the active dir name.
 */
export function openFeatureChange(
  projectRoot: string,
  sessionId: string,
  input: OpenFeatureChangeInput,
): string {
  const dirName = resolveActiveFeature(projectRoot, sessionId, input);
  const hasOpen = readFeatureStageUnit(projectRoot, dirName).some((row) => row.kind === 'open');
  if (!hasOpen) {
    appendFeatureStageRow(
      projectRoot,
      sessionId,
      dirName,
      {
        kind: 'open',
        adapter: input.adapter,
        lane: input.lane ?? null,
        // The branch this change is being built on (issue #404). Read once, here, so a
        // rotated session can recognise its own in-flight bundle from row 1 — a session
        // id rotates, a branch does not. `null` off a branch (detached HEAD, non-git).
        branch: readGitState(projectRoot).branch ?? null,
      },
      input.now,
    );
  }
  return dirName;
}

/**
 * Close the active feature for this session — the feature-dir analogue of
 * `closeSessionOrdinal`. Clears `active` in the `_session` control (via `markDone`) so
 * the NEXT stage/edit opens a fresh feature; the bundle's rows stay on disk as the
 * closed change's record. A no-op when nothing is active.
 *
 * The bundle is also stamped with a `kind:'close'` row when it does not already carry
 * one (issue #404). Clearing one session's pointer used to be the ONLY record that a
 * change was finished, which is invisible to every other session — so cross-session
 * adoption would read the bundle as still in flight and resurrect it. Writing the row
 * makes "closed" durable on the ledger itself. Idempotent: the finalizer appends its own
 * close row first (carrying the verdict), and this skips when one is present.
 */
export function closeActiveFeature(projectRoot: string, sessionId: string, now?: () => Date): void {
  const active = currentFeature(projectRoot, sessionId);
  if (!active) {
    return;
  }
  const rows = readFeatureStageUnit(projectRoot, active);
  // An unmaterialized bundle (no rows) is not in flight, so nothing can adopt it and it
  // needs no close row — stamping one would materialize an empty bundle just to close it.
  const adapter = lastAdapter(rows);
  if (adapter !== null && !rows.some((row) => row.kind === 'close')) {
    appendFeatureStageRow(
      projectRoot,
      sessionId,
      active,
      {
        kind: 'close',
        // The adapter is required on every row; inherit it from the bundle's own rows so
        // the close row is attributed to the host that actually recorded the change.
        adapter,
        event_status: 'completed',
        note: 'closed; active pointer released',
      },
      now,
    );
  }
  markDone(projectRoot, sessionId, active, now);
}

/** The adapter on the most recent row that carries one; null for an empty bundle. */
function lastAdapter(rows: readonly SessionLedgerRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const adapter = rows[i]!.adapter;
    if (typeof adapter === 'string' && adapter.length > 0) {
      return adapter;
    }
  }
  return null;
}

/**
 * Resolve a user-supplied feature ref to a known feature dir name for this session,
 * or `null` when nothing matches. A ref matches when it equals the full dir name, the
 * ULID, the issue, or (as a fallback) is a substring of the slug — checked against the
 * active feature and the paused stack (most-recently-paused first). Used by `resume`.
 */
export function resolveFeatureRef(
  projectRoot: string,
  sessionId: string,
  ref: string,
): string | null {
  const control = readSessionControl(projectRoot, sessionId);
  const candidates = [...control.paused].reverse();
  if (control.active) {
    candidates.push(control.active);
  }
  const needle = ref.trim().replace(/^#/, '');
  for (const dirName of candidates) {
    if (dirName === ref || dirName === needle) {
      return dirName;
    }
    const parts = parseFeatureDirName(dirName);
    if (!parts) {
      continue;
    }
    if (parts.ulid === needle || parts.issue === needle || parts.slug === needle) {
      return dirName;
    }
  }
  // Fallback: a slug substring match (e.g. "route" → "route-first-workflows").
  for (const dirName of candidates) {
    const parts = parseFeatureDirName(dirName);
    if (parts && parts.slug.includes(needle)) {
      return dirName;
    }
  }
  return null;
}

/**
 * Reactivate a paused feature by ref (ULID / issue / slug / dir name) — the writer
 * behind `paqad-ai resume --feature <ref>`. Returns the reactivated dir name, or
 * `null` when the ref matches no known feature or the match is not resumable.
 */
export function resumeFeatureByRef(
  projectRoot: string,
  sessionId: string,
  ref: string,
  now?: () => Date,
): string | null {
  const dirName = resolveFeatureRef(projectRoot, sessionId, ref);
  if (!dirName) {
    return null;
  }
  return resumeFeature(projectRoot, sessionId, dirName, now) ? dirName : null;
}
