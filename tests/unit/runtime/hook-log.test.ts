// The shared hook-failure log (issue #573).
//
// A runtime hook must never wedge the host, so it soft-fails. Before #573 that meant a
// bare `catch {}`, and a dangling compiled-half import went unnoticed for ~10 weeks. The
// helper under test keeps the soft-fail and adds the trace: one append-only line naming
// the hook and the error. Its own contract is that it NEVER throws, whatever the disk does.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK_LOG = join(__dirname, '..', '..', '..', 'runtime', 'hooks', 'lib', 'hook-log.mjs');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let hookLog: any;
let root: string;

beforeEach(async () => {
  hookLog = await import(HOOK_LOG);
  root = mkdtempSync(join(tmpdir(), 'paqad-hook-log-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function logLines(projectRoot: string): string[] {
  return readFileSync(hookLog.hookFailureLogPath(projectRoot), 'utf8')
    .split('\n')
    .filter((line: string) => line.trim().length > 0);
}

describe('logHookFailure (issue #573)', () => {
  it('writes one line naming the hook, the note and the error', () => {
    const written = hookLog.logHookFailure(
      root,
      'agent-entry-prompt-gate',
      new Error('boom'),
      'routing this prompt',
    );

    expect(written).toBe(true);
    const lines = logLines(root);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('ERROR agent-entry-prompt-gate');
    expect(lines[0]).toContain('(routing this prompt)');
    expect(lines[0]).toContain('boom');
  });

  it("includes an error's code, which is what identifies a missing compiled half", () => {
    const error = Object.assign(new Error("Cannot find module 'dist/pipeline/prompt-lane.js'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });

    hookLog.logHookFailure(root, 'agent-entry-prompt-gate', error);

    expect(logLines(root)[0]).toContain('ERR_MODULE_NOT_FOUND');
  });

  it('appends rather than truncating, so a repeating failure is visible', () => {
    hookLog.logHookFailure(root, 'ticket-intake-prompt', new Error('first'));
    hookLog.logHookFailure(root, 'ticket-intake-prompt', new Error('second'));

    const lines = logLines(root);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('first');
    expect(lines[1]).toContain('second');
  });

  it('records a non-Error throwable without crashing', () => {
    hookLog.logHookFailure(root, 'stage-writer', 'a bare string');

    expect(logLines(root)[0]).toContain('a bare string');
  });

  it('omits the note clause when none is given', () => {
    hookLog.logHookFailure(root, 'stage-writer', new Error('boom'));

    expect(logLines(root)[0]).toContain('ERROR stage-writer: boom');
  });

  it('returns false instead of throwing when the log cannot be written', () => {
    // `.paqad/logs` occupied by a FILE — mkdirSync recursive throws ENOTDIR/EEXIST. The
    // host path must survive this: a hook that cannot log still must not throw.
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad', 'logs'), 'not a directory');

    expect(() => hookLog.logHookFailure(root, 'stage-writer', new Error('boom'))).not.toThrow();
    expect(hookLog.logHookFailure(root, 'stage-writer', new Error('boom'))).toBe(false);
  });

  it('exposes the log path so callers never hand-build it', () => {
    expect(hookLog.hookFailureLogPath(root)).toBe(
      join(root, '.paqad', 'logs', hookLog.HOOK_FAILURE_LOG),
    );
    expect(hookLog.HOOK_FAILURE_LOG).toBe('hook-failures.log');
  });
});
