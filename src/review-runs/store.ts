import { readFileSync } from 'node:fs';

import { join } from 'pathe';

import { releaseLock, tryAcquireLock } from '@/background/single-flight-lock.js';
import { sleepSync } from '@/core/fs/atomic-rename.js';
import { writeFileAtomic } from '@/hud/files.js';

import { ReviewRefusal } from './errors.js';
import type { ReviewKind } from './kinds.js';
import type { ReviewRun } from './types.js';
import { buildReviewView, type ReviewView } from './view.js';

export const REVIEW_STALE_LOCK_MS = 30_000;

export interface ReviewLockOptions {
  attempts?: number;
  waitMs?: number;
  sleep?: (ms: number) => void;
  lockNow?: () => number;
}

export interface ReviewWriteOptions extends ReviewLockOptions {
  now?: () => Date;
  expectedRevision?: number;
}

export function reviewRunPath(projectRoot: string, kind: ReviewKind): string {
  return join(projectRoot, kind.run_path);
}

export function reviewViewPath(projectRoot: string, kind: ReviewKind): string {
  return join(projectRoot, kind.view_path);
}

export function reviewLockPath(projectRoot: string, kind: ReviewKind): string {
  return join(projectRoot, kind.lock_path);
}

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ReviewRefusal(`Could not read ${path}.`, { cause: error });
  }
}

export function readReviewRun(projectRoot: string, kind: ReviewKind): ReviewRun | null {
  const text = readTextOrNull(reviewRunPath(projectRoot, kind));
  if (text === null) return null;
  try {
    const run = JSON.parse(text) as ReviewRun;
    if (typeof run.revision !== 'number' || typeof run.stages !== 'object' || run.stages === null) {
      throw new TypeError('missing revision or stages');
    }
    return run;
  } catch (error) {
    throw new ReviewRefusal(
      `The ${kind.word.toLowerCase()} run file ${kind.run_path} is unreadable; move it aside and start again.`,
      { cause: error },
    );
  }
}

export function readReviewView(projectRoot: string, kind: ReviewKind): ReviewView | null {
  const text = readTextOrNull(reviewViewPath(projectRoot, kind));
  if (text === null) return null;
  try {
    return JSON.parse(text) as ReviewView;
  } catch {
    return null;
  }
}

export function withReviewLock<T>(
  projectRoot: string,
  kind: ReviewKind,
  work: () => T,
  options: ReviewLockOptions = {},
): T {
  const lockDir = reviewLockPath(projectRoot, kind);
  const attempts = options.attempts ?? 200;
  const sleep = options.sleep ?? sleepSync;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const outcome = tryAcquireLock(lockDir, {
      staleLockMs: REVIEW_STALE_LOCK_MS,
      ...(options.lockNow ? { now: options.lockNow } : {}),
    });
    if (outcome.acquired) {
      try {
        return work();
      } finally {
        releaseLock(lockDir);
      }
    }
    if (attempt + 1 < attempts) sleep(options.waitMs ?? 10);
  }
  throw new ReviewRefusal(
    `Another ${kind.verb} command is updating the run. Try again in a moment.`,
  );
}

export function writeReviewFiles(projectRoot: string, kind: ReviewKind, run: ReviewRun, now: Date) {
  writeFileAtomic(reviewRunPath(projectRoot, kind), `${JSON.stringify(run, null, 2)}\n`);
  const view = buildReviewView(kind, run, { now: () => now });
  writeFileAtomic(reviewViewPath(projectRoot, kind), `${JSON.stringify(view, null, 2)}\n`);
  return view;
}

export function commitReviewRun(
  projectRoot: string,
  kind: ReviewKind,
  change: (current: ReviewRun | null, at: string) => ReviewRun,
  options: ReviewWriteOptions = {},
): ReviewRun {
  const now = (options.now ?? (() => new Date()))();
  return withReviewLock(
    projectRoot,
    kind,
    () => {
      const current = readReviewRun(projectRoot, kind);
      const found = current?.revision ?? 0;
      if (options.expectedRevision !== undefined && options.expectedRevision !== found) {
        throw new ReviewRefusal(
          `The run changed while this command ran (expected revision ${options.expectedRevision}, found ${found}). Run it again.`,
        );
      }
      const at = now.toISOString();
      const draft = change(current === null ? null : structuredClone(current), at);
      const saved: ReviewRun = {
        ...draft,
        revision: draft.run_id === current?.run_id ? found + 1 : 1,
        updated_at: at,
      };
      writeReviewFiles(projectRoot, kind, saved, now);
      return saved;
    },
    options,
  );
}
