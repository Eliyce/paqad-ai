// Per-session feature control (issue #339, Phase 1 — dark).
//
// `_session/<sessionId>.json` holds one active feature plus a paused-feature stack
// and the pending lane. It folds today's `.open` + `.pending-lane` role at feature
// grain: `active` is the feature the next stage/edit attaches to; `paused` is the
// stack a detour pushed (most-recently-paused last), popped on resume. Values are
// feature dir names (the immutable change key). Reads are tolerant — a missing or
// corrupt file yields a fresh empty control, never a throw — so a mid-crash write
// can't wedge the session. Nothing wires this into the live path yet.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { featureSessionControlPath } from './paths.js';
import {
  FEATURE_EVIDENCE_SCHEMA_VERSION,
  FEATURE_SESSION_DOC_TYPE,
  type FeatureLane,
  type FeatureSessionControl,
} from './types.js';

/** A fresh, empty control for a session (no active, no paused, no lane). */
export function emptyControl(sessionId: string, now: () => Date = () => new Date()): FeatureSessionControl {
  return {
    schema_version: FEATURE_EVIDENCE_SCHEMA_VERSION,
    doc_type: FEATURE_SESSION_DOC_TYPE,
    session_id: sessionId,
    active: null,
    paused: [],
    lane: null,
    updated_at: now().toISOString(),
  };
}

/**
 * Read a session's control. A missing or corrupt/invalid file yields a fresh
 * empty control (tolerant, like the session-ledger reader) so a caller never has
 * to guard for absence.
 */
export function readSessionControl(
  projectRoot: string,
  sessionId: string,
  now: () => Date = () => new Date(),
): FeatureSessionControl {
  try {
    const raw = readFileSync(join(projectRoot, featureSessionControlPath(sessionId)), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (isControl(parsed)) {
      return parsed;
    }
  } catch {
    // Absent / unreadable / malformed — fall through to a fresh control.
  }
  return emptyControl(sessionId, now);
}

/** Stamp `updated_at` and atomically write the control to disk. Returns it. */
export function writeSessionControl(
  projectRoot: string,
  control: FeatureSessionControl,
  now: () => Date = () => new Date(),
): FeatureSessionControl {
  const stamped: FeatureSessionControl = { ...control, updated_at: now().toISOString() };
  const abs = join(projectRoot, featureSessionControlPath(control.session_id));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(stamped, null, 2)}\n`, 'utf8');
  return stamped;
}

export interface SetActiveOptions {
  /** Lane to stamp on the control; unchanged when omitted. */
  lane?: FeatureLane;
  now?: () => Date;
}

/**
 * Make `dirName` the active feature and persist. A different current active is
 * pushed onto the paused stack; if `dirName` was itself paused it is lifted out
 * of the stack first (a feature is never both active and paused). Setting the
 * already-active feature is a no-op beyond the optional lane update.
 */
export function setActiveFeature(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  options: SetActiveOptions = {},
): FeatureSessionControl {
  const now = options.now ?? (() => new Date());
  const control = readSessionControl(projectRoot, sessionId, now);
  const paused = control.paused.filter((name) => name !== dirName);
  if (control.active && control.active !== dirName) {
    paused.push(control.active);
  }
  const next: FeatureSessionControl = {
    ...control,
    active: dirName,
    paused,
    lane: options.lane !== undefined ? options.lane : control.lane,
  };
  return writeSessionControl(projectRoot, next, now);
}

/**
 * Reactivate a paused feature. Pops `dirName` off the paused stack and makes it
 * active, pushing any current active back onto the stack. Returns `null` (no
 * write) when `dirName` is neither active nor paused — resume of an unknown
 * feature is a caller error, surfaced honestly rather than silently minting one.
 */
export function resumeFeature(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  now: () => Date = () => new Date(),
): FeatureSessionControl | null {
  const control = readSessionControl(projectRoot, sessionId, now);
  if (control.active === dirName) {
    return control;
  }
  if (!control.paused.includes(dirName)) {
    return null;
  }
  const paused = control.paused.filter((name) => name !== dirName);
  if (control.active) {
    paused.push(control.active);
  }
  return writeSessionControl(projectRoot, { ...control, active: dirName, paused }, now);
}

/** Pause the active feature (push it onto the stack, clear `active`) and persist. */
export function pauseActive(
  projectRoot: string,
  sessionId: string,
  now: () => Date = () => new Date(),
): FeatureSessionControl {
  const control = readSessionControl(projectRoot, sessionId, now);
  if (!control.active) {
    return control;
  }
  const paused = [...control.paused, control.active];
  return writeSessionControl(projectRoot, { ...control, active: null, paused }, now);
}

/**
 * Drop `dirName` from the session control (its lifecycle `status:done` lives in
 * `feature.json`). Clears `active` when it matches and removes any paused entry.
 */
export function markDone(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  now: () => Date = () => new Date(),
): FeatureSessionControl {
  const control = readSessionControl(projectRoot, sessionId, now);
  const next: FeatureSessionControl = {
    ...control,
    active: control.active === dirName ? null : control.active,
    paused: control.paused.filter((name) => name !== dirName),
  };
  return writeSessionControl(projectRoot, next, now);
}

/** Stash the pending lane on the control and persist. */
export function setLane(
  projectRoot: string,
  sessionId: string,
  lane: FeatureLane,
  now: () => Date = () => new Date(),
): FeatureSessionControl {
  const control = readSessionControl(projectRoot, sessionId, now);
  return writeSessionControl(projectRoot, { ...control, lane }, now);
}

function isControl(value: unknown): value is FeatureSessionControl {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    c.doc_type === FEATURE_SESSION_DOC_TYPE &&
    typeof c.session_id === 'string' &&
    (c.active === null || typeof c.active === 'string') &&
    Array.isArray(c.paused) &&
    c.paused.every((name) => typeof name === 'string')
  );
}
