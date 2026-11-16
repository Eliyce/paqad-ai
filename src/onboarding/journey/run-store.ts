import { join } from 'node:path';

import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';
import { PATHS } from '@/core/constants/paths.js';
import { sleepSync } from '@/core/fs/atomic-rename.js';
import { writeFileAtomic } from '@/hud/files.js';

import { readTextOrNull } from './io.js';
import { STAGE_IDS, type JourneyRun, type StageId, type StageRecord } from './types.js';

export const JOURNEY_STALE_LOCK_MS = 30_000;
const LOCK_ATTEMPTS = 200;
const LOCK_WAIT_MS = 10;

export class JourneyLockBusyError extends Error {
  constructor() {
    super('Another onboarding command is updating the journey. Try again in a moment.');
    this.name = 'JourneyLockBusyError';
  }
}

export class JourneyRevisionConflictError extends Error {
  constructor(expected: number, found: number) {
    super(
      `The journey changed while this command ran (expected revision ${expected}, found ${found}). Run it again.`,
    );
    this.name = 'JourneyRevisionConflictError';
  }
}

export class JourneyMissingError extends Error {
  constructor() {
    super('No onboarding journey has started here. Run `paqad-ai onboarding start` first.');
    this.name = 'JourneyMissingError';
  }
}

export function journeyPath(projectRoot: string): string {
  return join(projectRoot, PATHS.ONBOARDING_JOURNEY);
}

export function journeyLockPath(projectRoot: string): string {
  return join(projectRoot, PATHS.ONBOARDING_JOURNEY_LOCK);
}

export function readRun(projectRoot: string): JourneyRun | null {
  const text = readTextOrNull(journeyPath(projectRoot));
  return text === null ? null : (JSON.parse(text) as JourneyRun);
}

export function requireRun(projectRoot: string): JourneyRun {
  const run = readRun(projectRoot);
  if (!run) throw new JourneyMissingError();
  return run;
}

export function emptyStages(): Record<StageId, StageRecord> {
  return Object.fromEntries(STAGE_IDS.map((id) => [id, { status: 'not_started' }])) as Record<
    StageId,
    StageRecord
  >;
}

export function withJourneyLock<T>(projectRoot: string, work: () => T, now?: () => number): T {
  const lockDir = journeyLockPath(projectRoot);
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const outcome = tryAcquireLock(lockDir, { staleLockMs: JOURNEY_STALE_LOCK_MS, now });
    if (outcome.acquired) {
      try {
        return work();
      } finally {
        releaseLock(lockDir);
      }
    }
    sleepSync(LOCK_WAIT_MS);
  }
  throw new JourneyLockBusyError();
}

function writeRun(projectRoot: string, run: JourneyRun): void {
  writeFileAtomic(journeyPath(projectRoot), `${JSON.stringify(run, null, 2)}\n`);
}

export function createRun(projectRoot: string, run: Omit<JourneyRun, 'revision'>): JourneyRun {
  return withJourneyLock(projectRoot, () => {
    const created: JourneyRun = { ...run, revision: 1 };
    writeRun(projectRoot, created);
    return created;
  });
}

export function updateRun(
  projectRoot: string,
  mutate: (run: JourneyRun) => JourneyRun | void,
  options: { expectedRevision?: number; now?: () => Date } = {},
): JourneyRun {
  const now = options.now ?? (() => new Date());
  return withJourneyLock(projectRoot, () => {
    const current = requireRun(projectRoot);
    if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision) {
      throw new JourneyRevisionConflictError(options.expectedRevision, current.revision);
    }
    const draft = structuredClone(current);
    const next = mutate(draft) ?? draft;
    const saved: JourneyRun = {
      ...next,
      revision: current.revision + 1,
      updated_at: now().toISOString(),
    };
    writeRun(projectRoot, saved);
    return saved;
  });
}
