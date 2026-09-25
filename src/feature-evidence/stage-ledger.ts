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
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';
import { augmentWithBundleArtifacts, foldRowsWithKey } from '@/stage-evidence/fold.js';
import { BACKSTOP_WRITER, ORCHESTRATOR_AGENT } from '@/stage-evidence/agent-identity.js';
import { validateStageEvidenceRow } from '@/stage-evidence/schema.js';
import {
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_SCHEMA_VERSION,
  type FoldedChange,
} from '@/stage-evidence/types.js';

import { adoptableInFlightOnBranch, reconcileSessionControl } from './adoption.js';
import { seedFeatureDelivery } from './delivery.js';
import { listFeatureDirs } from './enumerate.js';
import {
  readChangeConstants,
  seedFeatureRecord,
  updateFeatureRecord,
  type FeatureRecordPatch,
} from './feature-record.js';
import { UNTITLED_FEATURE_TITLE, mintFeatureDirName } from './mint.js';
import { stampBundleRow } from './envelope.js';
import { featureChangeKey, featureFilePath, parseFeatureDirName } from './paths.js';
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
  // Issue #567 (AC-9) — stage isolation is core-engine behavior, and a change must keep ONE
  // identity across its isolated stages. If the branch already carries two or more in-flight
  // bundles, adoption is ambiguous (reconcile returned null), so auto-minting here would fork a
  // THIRD. Refuse loudly with a named reason instead. An explicit change ref (`input.title`,
  // handled above) always wins, so a deliberate new change is never blocked by this.
  const inFlight = adoptableInFlightOnBranch(projectRoot, sessionId, input.now);
  if (inFlight.length >= 2) {
    throw new Error(
      `stage isolation: ${inFlight.length} in-flight feature bundles on this branch ` +
        `(${inFlight.join(', ')}) — a change must keep one identity, so paqad will not mint ` +
        `a third. Close or finish the extra bundle(s), or pass an explicit change (stage ` +
        `start --title …), before continuing.`,
    );
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
 * Append one stage-evidence row into the feature's bundle, stamped with the one bundle
 * envelope header (issue #581, FR-5: `change` is the folder-name ULID, `recorded_at` the
 * script clock) and validated by the stage-evidence schema. The retired
 * `conversation_ordinal` and `ts` are no longer written; readers still accept a row that
 * has them (INV-8).
 *
 * Issue #581 (FR-6) — a row carries no session constants (`adapter`, `branch`, `lane`).
 * Those live once on `feature.json`; record them with {@link recordChangeConstants}.
 */
export function appendFeatureStageRow(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  row: Record<string, unknown>,
  now?: () => Date,
): SessionLedgerRow {
  const stamped = stampBundleRow({
    docType: STAGE_EVIDENCE_DOC_TYPE,
    change: featureChangeKey(dirName),
    sessionId,
    schemaVersion: STAGE_EVIDENCE_SCHEMA_VERSION,
    // Issue #573 — `agent` is REQUIRED by the schema and this is the one write
    // chokepoint, so default it here rather than at every call site. A caller that knows
    // it is inside a dispatched stage agent passes its own identity and wins; everything
    // else is the main chat.
    row: { ...row, agent: row.agent ?? ORCHESTRATOR_AGENT },
    validate: (r) => validateStageEvidenceRow(r),
    now,
  }) as unknown as SessionLedgerRow;
  appendStampedRowToUnit(projectRoot, featureStagePath(dirName), stamped);
  return stamped;
}

/** The session constants a stage writer knows at the time it records a row (issue #581). */
export interface ChangeConstantsInput {
  adapter?: string;
  lane?: FeatureLane;
  branch?: string | null;
  baseBranch?: string | null;
}

/**
 * Update the change's session constants on `feature.json` in place (issue #581, FR-6), the
 * latest host winning. Only facts the caller actually knows are written: an unresolved
 * (null) lane never erases a recorded one, and the completion backstop is a writer, not a
 * host, so it never replaces the adapter. A no-op write is skipped by
 * {@link updateFeatureRecord}, so calling this per row never churns the file. Best-effort.
 */
export function recordChangeConstants(
  projectRoot: string,
  dirName: string,
  input: ChangeConstantsInput,
  now?: () => Date,
): void {
  const patch: FeatureRecordPatch = {};
  if (input.adapter && input.adapter !== BACKSTOP_WRITER) patch.adapter = input.adapter;
  if (input.lane) patch.lane = input.lane;
  if (input.branch) patch.branch = input.branch;
  if (input.baseBranch) patch.base_branch = input.baseBranch;
  if (Object.keys(patch).length > 0) {
    updateFeatureRecord(projectRoot, dirName, patch, now);
  }
}

/** Tolerant read of a feature's stage-evidence rows. */
export function readFeatureStageUnit(projectRoot: string, dirName: string): SessionLedgerRow[] {
  return readUnitFile(projectRoot, featureStagePath(dirName));
}

/** Fold a feature's stage rows into the per-change view, keyed by the dir name. */
export function foldFeature(projectRoot: string, sessionId: string, dirName: string): FoldedChange {
  const rows = readFeatureStageUnit(projectRoot, dirName);
  // Issue #581 (FR-6) — the lane is a session constant on feature.json; the fold core only
  // knows the legacy open row, so the bundle-aware reader supplies the lane it resolved.
  const fold = {
    ...foldRowsWithKey(rows, { sessionId, changeKey: dirName, promptOrdinal: 0 }),
    lane: readChangeConstants(projectRoot, dirName, rows).lane,
  };
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
  // The branch this change is being built on (issue #404), so a rotated session can
  // recognise its own in-flight bundle — a session id rotates, a branch does not. `null`
  // off a branch (detached HEAD, non-git).
  const gitState = readGitState(projectRoot);
  // Issue #511 (RC-1) — seed feature.json when the feature is opened, so every bundle
  // carries its identity/status record from birth (not just its dir name). Issue #581 —
  // it is also the one home of the session constants, so the branch and its base are
  // stamped here, never on a row. Best-effort, so a write fault never breaks the open path.
  const seeded = seedFeatureRecord(projectRoot, dirName, {
    adapter: input.adapter,
    sessionId,
    lane: input.lane ?? null,
    branch: gitState.branch ?? null,
    baseBranch: gitState.base_branch ?? null,
    now: input.now,
  });
  // A re-open (another host, or a record seeded before #581 with no branch) updates the
  // constants in place: the latest host wins (AC-26).
  if (seeded) {
    recordChangeConstants(
      projectRoot,
      dirName,
      {
        adapter: input.adapter,
        lane: input.lane ?? null,
        branch: gitState.branch ?? null,
        baseBranch: gitState.base_branch ?? null,
      },
      input.now,
    );
  }
  const hasOpen = readFeatureStageUnit(projectRoot, dirName).some((row) => row.kind === 'open');
  if (!hasOpen) {
    appendFeatureStageRow(projectRoot, sessionId, dirName, { kind: 'open' }, input.now);
    // Issue #511 (RC-2) — seed delivery.json with the branch + base at open, so the FIRST
    // commit on this branch links to this bundle (the branch-match had nothing to match on
    // before). Best-effort — a git/write fault never breaks the open path.
    try {
      seedFeatureDelivery(projectRoot, dirName, {
        branch: gitState.branch ?? null,
        baseBranch: gitState.base_branch ?? null,
        capturedAt: (input.now ?? (() => new Date()))().toISOString(),
      });
      /* v8 ignore next 3 -- best-effort: a delivery seed fault must not break feature open. */
    } catch {
      // Nothing to do — feature.json + the open row are already written.
    }
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
  if (rows.length > 0 && !rows.some((row) => row.kind === 'close')) {
    appendFeatureStageRow(
      projectRoot,
      sessionId,
      active,
      {
        kind: 'close',
        event_status: 'completed',
        note: 'closed; active pointer released',
      },
      now,
    );
  }
  // Issue #511 (RC-1) — record the change is finished on feature.json itself, so a reader
  // (the report, an export) sees `status:'done'` and not a stale `active`. Best-effort.
  updateFeatureRecord(projectRoot, active, { status: 'done' }, now);
  markDone(projectRoot, sessionId, active, now);
}

/**
 * Resolve a user-supplied feature ref to a feature dir name, or `null` when nothing
 * matches. A ref matches when it equals the full dir name, the ULID, the issue, or (as a
 * fallback) is a substring of the slug. Used by `resume`.
 *
 * The session control is searched FIRST and wins — the active feature and the paused stack
 * (most-recently-paused first) — then, when nothing there matches, every bundle recorded on
 * disk (issue #540). The control is not the whole record: `markDone` drops a finished
 * change from it, and a session-id rotation leaves a bundle in a control this session never
 * reads, so a control-only lookup made recorded evidence unreachable through any supported
 * command and left hand-editing `_session/<id>.json` as the only recovery (INV-1, INV-2).
 * The sweep only resolves a ref the developer typed, and it mints nothing.
 */
export function resolveFeatureRef(
  projectRoot: string,
  sessionId: string,
  ref: string,
): string | null {
  const control = readSessionControl(projectRoot, sessionId);
  const known = [...control.paused].reverse();
  if (control.active) {
    known.push(control.active);
  }
  // Control first, then the on-disk sweep — and each tier is matched exactly before either
  // falls back to a slug substring, so a precise ref never loses to a loose match.
  const onDisk = listFeatureDirs(projectRoot).filter((dirName) => !known.includes(dirName));
  const needle = ref.trim().replace(/^#/, '');
  for (const candidates of [known, onDisk]) {
    const match = matchFeatureRef(candidates, ref, needle);
    if (match) {
      return match;
    }
  }
  return null;
}

/** Exact match (dir name / ULID / issue / slug) across `candidates`, else a slug substring. */
function matchFeatureRef(
  candidates: readonly string[],
  ref: string,
  needle: string,
): string | null {
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
 * Reactivate a feature by ref (ULID / issue / slug / dir name) — the writer behind
 * `paqad-ai resume --feature <ref>`. Returns the reactivated dir name, or `null` when the
 * ref matches no recorded feature.
 *
 * A ref the session control holds is popped off the paused stack as before. A ref that
 * resolved from the on-disk sweep is made active through `setActiveFeature` (issue #540),
 * which pushes the outgoing active onto `paused[]` — so redirecting the session at a
 * displaced change never drops the one it was on.
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
  if (resumeFeature(projectRoot, sessionId, dirName, now)) {
    return dirName;
  }
  setActiveFeature(projectRoot, sessionId, dirName, { now });
  return dirName;
}
