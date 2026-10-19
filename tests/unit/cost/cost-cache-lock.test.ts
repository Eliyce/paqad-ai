import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { readCostCache, updateCostCache } from '@/cost/change-cost.js';
import { hudCostCachePath } from '@/hud/files.js';

import { DIR, SES, assistant, at, writeTranscript } from './cost.fixture.js';

// Issue #639, Part 23 (review fix): the cost cache's read-merge-write runs under a cross-process
// lock, so parallel SubagentStop hooks (the High Table's seats end together) never lose a
// transcript path. A lock that cannot be taken is logged to hooks.log and skipped, never thrown.

const REPO = process.cwd();
const CLI = join(REPO, 'dist/cli/index.js');
const HOOK_COST = pathToFileURL(join(REPO, 'dist/cost/hook-cost.js')).href;

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-cost-lock-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const A = { input: 100, output: 200 };

function hooksLog(root: string): string {
  const path = join(root, '.paqad/logs/hooks.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('the cost cache lock', () => {
  it('waits for a parallel writer and keeps the path it recorded (interleaved)', () => {
    const root = tempRoot();
    const first = writeTranscript(root, 'first', [assistant('m1', '10:01', A)]);
    const second = writeTranscript(root, 'second', [assistant('m2', '10:02', A)]);
    const path = hudCostCachePath(root, SES);
    const lockDir = `${path}.lock`;

    // Another hook holds the lock. While we wait, it finishes its own update (recording
    // `first`) and releases the lock; only then may our read-merge-write run.
    mkdirSync(lockDir, { recursive: true });
    let waits = 0;
    const cache = updateCostCache({
      projectRoot: root,
      sessionId: SES,
      dirName: DIR,
      payload: { transcript_path: second },
      floor: at('10:00'),
      lock: {
        sleep: () => {
          waits += 1;
          if (waits !== 1) return;
          rmSync(lockDir, { recursive: true });
          updateCostCache({
            projectRoot: root,
            sessionId: SES,
            dirName: DIR,
            payload: { transcript_path: first },
            floor: at('10:00'),
          });
        },
      },
    });

    expect(waits).toBeGreaterThanOrEqual(1);
    expect(Object.keys(cache.sources).sort()).toEqual([first, second].sort());
    expect(Object.keys(readCostCache(path, SES).sources).sort()).toEqual([first, second].sort());
    expect(existsSync(lockDir)).toBe(false);
  });

  it('skips and logs to hooks.log when the lock cannot be taken, never throwing', () => {
    const root = tempRoot();
    const first = writeTranscript(root, 'first', [assistant('m1', '10:01', A)]);
    const path = hudCostCachePath(root, SES);
    mkdirSync(`${path}.lock`, { recursive: true });
    let clock = 0;
    const cache = updateCostCache({
      projectRoot: root,
      sessionId: SES,
      dirName: DIR,
      payload: { transcript_path: first },
      floor: at('10:00'),
      lock: { timeoutMs: 50, staleMs: 60_000, now: () => clock, sleep: () => (clock += 30) },
    });
    expect(cache.sources).toEqual({});
    expect(existsSync(path)).toBe(false);
    expect(hooksLog(root)).toMatch(/cost: cache not updated: could not take the lock/);
  });

  it('still throws a real write fault so the hook can log it', () => {
    const root = tempRoot();
    const first = writeTranscript(root, 'first', [assistant('m1', '10:01', A)]);
    const path = hudCostCachePath(root, SES);
    // A directory where the cache file goes makes the rename fail.
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'keep'), 'x');
    expect(() =>
      updateCostCache({
        projectRoot: root,
        sessionId: SES,
        dirName: DIR,
        payload: { transcript_path: first },
        floor: at('10:00'),
      }),
    ).toThrow();
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it('parallel processes recording different transcripts lose no path', async () => {
    const root = tempRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
    const session = 'ses_cost_lock';
    await execa(
      'node',
      [CLI, 'stage', 'start', 'planning', '--title', 'ord501', '--issue', '501'],
      {
        cwd: root,
        env: { SE_SESSION: session },
        reject: false,
      },
    );
    const bundles = readdirSync(join(root, '.paqad/ledger/feature-evidence')).filter(
      (name) => name !== '_session',
    );
    expect(bundles).toHaveLength(1);

    const now = new Date().toISOString();
    const paths = Array.from({ length: 8 }, (_, index) =>
      writeTranscript(root, `agent-${index}`, [
        assistant(`m${index}`, '10:00', A).replace(/"timestamp":"[^"]+"/, `"timestamp":"${now}"`),
      ]),
    );
    const script =
      `const m = await import(${JSON.stringify(HOOK_COST)});` +
      'm.refreshChangeCostFromHook({ projectRoot: process.argv[1], ' +
      'payload: { agent_transcript_path: process.argv[2], agent_type: "paqad-development" } });';
    const results = await Promise.all(
      paths.map((path) =>
        execa('node', ['--input-type=module', '-e', script, root, path], {
          env: { SE_SESSION: session, PAQAD_PROJECT_ROOT: root },
          reject: false,
        }),
      ),
    );
    for (const result of results) expect(result.stderr).toBe('');

    const cache = readCostCache(hudCostCachePath(root, session), session);
    expect(Object.keys(cache.sources).sort()).toEqual([...paths].sort());
    expect(hooksLog(root)).not.toMatch(/cost: cache not updated/);
  }, 60_000);
});
