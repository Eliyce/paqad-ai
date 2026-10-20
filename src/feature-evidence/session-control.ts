import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { featureSessionControlPath } from './paths.js';
import {
  FEATURE_EVIDENCE_SCHEMA_VERSION,
  FEATURE_SESSION_DOC_TYPE,
  type FeatureLane,
  type FeatureSessionControl,
} from './types.js';

export function emptyControl(
  sessionId: string,
  now: () => Date = () => new Date(),
): FeatureSessionControl {
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
  } catch {}
  return emptyControl(sessionId, now);
}

export function writeSessionControl(
  projectRoot: string,
  control: FeatureSessionControl,
  now: () => Date = () => new Date(),
  writtenBy?: string,
): FeatureSessionControl {
  const stamped: FeatureSessionControl = {
    ...control,
    written_by: writtenBy ?? control.written_by ?? 'unknown',
    pid: process.pid,
    updated_at: now().toISOString(),
  };
  const abs = join(projectRoot, featureSessionControlPath(control.session_id));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(stamped, null, 2)}\n`, 'utf8');
  return stamped;
}

export interface SetActiveOptions {
  lane?: FeatureLane;
  now?: () => Date;
  writtenBy?: string;
}

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
  return writeSessionControl(projectRoot, next, now, options.writtenBy ?? 'set-active');
}

export function resumeFeature(
  projectRoot: string,
  sessionId: string,
  dirName: string,
  now: () => Date = () => new Date(),
  writtenBy = 'resume',
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
  return writeSessionControl(projectRoot, { ...control, active: dirName, paused }, now, writtenBy);
}

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
  return writeSessionControl(
    projectRoot,
    { ...control, active: null, paused },
    now,
    'pause-active',
  );
}

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
  return writeSessionControl(projectRoot, next, now, 'mark-done');
}

export function setLane(
  projectRoot: string,
  sessionId: string,
  lane: FeatureLane,
  now: () => Date = () => new Date(),
): FeatureSessionControl {
  const control = readSessionControl(projectRoot, sessionId, now);
  return writeSessionControl(projectRoot, { ...control, lane }, now, 'set-lane');
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
