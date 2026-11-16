import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendEvent, readEvents } from '../../../../src/onboarding/journey/events.js';
import {
  JourneyLockBusyError,
  JourneyMissingError,
  JourneyRevisionConflictError,
  journeyLockPath,
  readRun,
  requireRun,
  updateRun,
  withJourneyLock,
} from '../../../../src/onboarding/journey/run-store.js';

import { T0, clockAt, seedRun, tempRoot, writeFile } from './fixtures/journey.js';

const WRITER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/parallel-writer.mjs');

describe('journey run store', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates the run at revision 1 and bumps the revision on every update', () => {
    seedRun(root);
    const updated = updateRun(
      root,
      (run) => {
        run.status = 'paused';
      },
      { now: clockAt(5) },
    );
    expect(updated.revision).toBe(2);
    expect(updated.updated_at).toBe('2026-01-01T10:05:00.000Z');
    expect(readRun(root)?.status).toBe('paused');
  });

  it('FR-18: refuses a stale revision (compare-and-set) and leaves the file unchanged', () => {
    seedRun(root);
    expect(() =>
      updateRun(
        root,
        (run) => {
          run.status = 'failed';
        },
        { expectedRevision: 7 },
      ),
    ).toThrow(JourneyRevisionConflictError);
    expect(readRun(root)?.status).toBe('running');
    expect(readRun(root)?.revision).toBe(1);
  });

  it('reports a missing run and returns null before start', () => {
    expect(readRun(root)).toBeNull();
    expect(() => requireRun(root)).toThrow(JourneyMissingError);
  });

  it('FR-18: a held lock makes a second writer give up instead of tearing the file', () => {
    seedRun(root);
    mkdirSync(journeyLockPath(root), { recursive: true });
    expect(() =>
      withJourneyLock(
        root,
        () => 1,
        () => new Date(T0).getTime(),
      ),
    ).toThrow(JourneyLockBusyError);
  });

  it('FR-18: reclaims a stale lock left by a crashed writer', () => {
    seedRun(root);
    mkdirSync(journeyLockPath(root), { recursive: true });
    const later = Date.parse('2999-01-01T00:00:00.000Z');
    expect(
      withJourneyLock(
        root,
        () => 'ran',
        () => later,
      ),
    ).toBe('ran');
  });

  it('NFR-12: two processes updating in parallel lose no write and leave valid JSON', () => {
    seedRun(root, { providers: [] });
    const run = (label: string): Promise<void> =>
      new Promise((resolve, reject) => {
        execFile(process.execPath, [WRITER, root, '8', label], (error) =>
          error ? reject(error) : resolve(),
        );
      });
    return Promise.all([run('a'), run('b')]).then(() => {
      const final = JSON.parse(readFileSync(join(root, '.paqad/onboarding/journey.json'), 'utf8'));
      expect(final.revision).toBe(17);
      expect(final.providers).toHaveLength(16);
      expect(readEvents(root)).toHaveLength(16);
    });
  });

  it('skips a torn trailing line in events.jsonl', () => {
    appendEvent(root, { ts: T0, run_id: 'run-1', kind: 'heartbeat' });
    writeFile(root, '.paqad/onboarding/extra.txt', '');
    const path = join(root, '.paqad/onboarding/events.jsonl');
    execFileSync(process.execPath, [
      '-e',
      `require('fs').appendFileSync(${JSON.stringify(path)}, '{"ts":"x')`,
    ]);
    expect(readEvents(root)).toHaveLength(1);
    expect(readEvents(root, 'other')).toHaveLength(0);
  });
});
