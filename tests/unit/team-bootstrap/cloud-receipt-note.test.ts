import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readFeatureDelivery, writeFeatureDelivery } from '@/feature-evidence/delivery.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import {
  CLOUD_CONTINUATION_NOTE,
  cloudContinuationNote,
} from '@/verification/repository/cloud-continuation.js';

const SESSION = 'cloud-ses';
const REMOTE = { CLAUDE_CODE_REMOTE: 'true' } as NodeJS.ProcessEnv;

let root: string;
let dir: string;

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function commit(file: string): void {
  writeFileSync(join(root, file), file);
  git('add', file);
  git(
    '-c',
    'user.email=t@t',
    '-c',
    'user.name=t',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    file,
  );
}

function setStart(start: string | null, base: string | null): void {
  const delivery = readFeatureDelivery(root, dir);
  writeFeatureDelivery(root, dir, { ...delivery, start_commit: start, base_branch: base });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-cloud-note-'));
  git('init', '-q', '-b', 'main');
  commit('a.txt');
  git('checkout', '-q', '-b', 'feat/x');
  commit('b.txt');
  dir = openFeatureChange(root, SESSION, {
    adapter: 'claude-code',
    title: 'cloud work',
    lane: 'full',
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the cloud continuation note', () => {
  it('appears in a cloud session for a bundle opened here on a branch with earlier commits', () => {
    setStart(git('rev-parse', 'HEAD'), 'main');
    expect(cloudContinuationNote(root, dir, SESSION, REMOTE)).toBe(CLOUD_CONTINUATION_NOTE);
    expect(CLOUD_CONTINUATION_NOTE).toBe(
      'Evidence starts in this cloud session; earlier steps were recorded on another machine.',
    );
  });

  it('falls back to the remote base when the local base branch is missing', () => {
    setStart('feed', 'main');
    const ranges: string[] = [];
    const count = (_root: string, range: string) => {
      ranges.push(range);
      return range.startsWith('origin/') ? 2 : null;
    };
    expect(cloudContinuationNote(root, dir, SESSION, REMOTE, count)).toBe(CLOUD_CONTINUATION_NOTE);
    expect(ranges).toEqual(['main..feed', 'origin/main..feed']);
  });

  it.each([
    ['not a cloud session', {}, SESSION],
    ['a bundle opened in another session', REMOTE, 'other-session'],
    ['no session id', REMOTE, ''],
  ])('is absent for %s', (_name, env, session) => {
    setStart(git('rev-parse', 'HEAD'), 'main');
    expect(cloudContinuationNote(root, dir, session, env as NodeJS.ProcessEnv)).toBeNull();
  });

  it('is absent when the branch had no commits for the change when it opened', () => {
    setStart(git('rev-parse', 'main'), 'main');
    expect(cloudContinuationNote(root, dir, SESSION, REMOTE)).toBeNull();
  });

  it('is absent when git fails or nothing is recorded', () => {
    setStart('0000000000000000000000000000000000000000', 'nope');
    expect(cloudContinuationNote(root, dir, SESSION, REMOTE)).toBeNull();
    setStart(null, 'main');
    expect(cloudContinuationNote(root, dir, SESSION, REMOTE)).toBeNull();
    expect(cloudContinuationNote(root, null, SESSION, REMOTE)).toBeNull();
    expect(cloudContinuationNote(root, 'missing-bundle', SESSION, REMOTE)).toBeNull();
  });
});
