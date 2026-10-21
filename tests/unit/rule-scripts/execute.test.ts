import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { executeRuleScript, isOnPath, missingBinaries } from '@/rule-scripts/execute.js';

const VALID = JSON.stringify({ rule_id: 'RL-00a1', kind: 'deterministic', findings: [] });

describe('executeRuleScript', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-rule-exec-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function script(name: string, body: string): string {
    const path = join(dir, `${name}.cjs`);
    writeFileSync(path, body);
    return path;
  }

  const payload = { projectRoot: '/repo', files: ['src/a.ts'] };

  it('passes the payload on stdin and returns a clean report', () => {
    const path = script(
      'echo',
      `let input='';process.stdin.on('data',(c)=>input+=c);process.stdin.on('end',()=>{const p=JSON.parse(input);process.stdout.write(JSON.stringify({rule_id:'RL-00a1',kind:'heuristic',findings:[{file:p.files[0],message:'m',severity:'low'}]}));});`,
    );
    expect(executeRuleScript(path, payload)).toEqual({
      ok: true,
      report: {
        rule_id: 'RL-00a1',
        kind: 'heuristic',
        findings: [{ file: 'src/a.ts', message: 'm', severity: 'low' }],
      },
    });
  });

  it('keeps a valid report and warns when the script exits non-zero or writes stderr', () => {
    const failedWithMessage = script(
      'warn-exit',
      `process.stdout.write(${JSON.stringify(VALID)});process.stderr.write('slow');process.exitCode=1;`,
    );
    const failedQuietly = script(
      'quiet-exit',
      `process.stdout.write(${JSON.stringify(VALID)});process.exitCode=3;`,
    );
    const noisy = script(
      'stderr-only',
      `process.stdout.write(${JSON.stringify(VALID)});process.stderr.write(' note ');`,
    );

    expect(executeRuleScript(failedWithMessage, payload)).toMatchObject({
      ok: true,
      warning: 'script exited 1: slow',
    });
    expect(executeRuleScript(failedQuietly, payload)).toMatchObject({
      ok: true,
      warning: 'script exited 3',
    });
    expect(executeRuleScript(noisy, payload)).toMatchObject({ ok: true, warning: 'note' });
  });

  it('rejects findings that fail the schema', () => {
    const zeroExit = script('bad-schema', `process.stdout.write('{"rule_id":1}');`);
    const failingExit = script(
      'bad-schema-exit',
      `process.stdout.write('{"rule_id":1}');process.stderr.write('boom');process.exitCode=2;`,
    );

    expect(executeRuleScript(zeroExit, payload).error).toMatch(/^findings failed schema: /);
    expect(executeRuleScript(failingExit, payload)).toEqual({
      ok: false,
      error: 'script exited 2: boom',
    });
  });

  it('reports output that is not JSON', () => {
    const zeroExit = script('not-json', `process.stdout.write('hello');`);
    const failingExit = script(
      'not-json-exit',
      `process.stdout.write('hello');process.exitCode=4;`,
    );

    expect(executeRuleScript(zeroExit, payload)).toEqual({
      ok: false,
      error: 'invalid findings JSON on stdout: hello',
    });
    expect(executeRuleScript(failingExit, payload)).toEqual({
      ok: false,
      error: 'script exited 4 with no parseable findings',
    });
  });

  it('stops a script that runs past its timeout', () => {
    const path = script('spin', 'for(;;){}');
    expect(executeRuleScript(path, payload, 200)).toEqual({
      ok: false,
      error: 'script timed out after 200ms',
    });
  });

  it.skipIf(process.platform === 'win32')('reports a script killed by a signal', () => {
    const path = script('suicide', `process.kill(process.pid,'SIGKILL');`);
    expect(executeRuleScript(path, payload)).toEqual({
      ok: false,
      error: 'script killed by signal SIGKILL',
    });
  });
});

describe('isOnPath and missingBinaries', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-rule-path-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('checks a path that names a file directly', () => {
    const runnable = join(dir, 'tool');
    writeFileSync(runnable, '#!/bin/sh\n');
    chmodSync(runnable, 0o755);
    const plain = join(dir, 'notes.txt');
    writeFileSync(plain, 'x');
    mkdirSync(join(dir, 'folder'));

    expect(isOnPath(runnable)).toBe(true);
    expect(isOnPath(plain)).toBe(process.platform === 'win32');
    expect(isOnPath(join(dir, 'folder'))).toBe(false);
    expect(isOnPath(join(dir, 'missing'))).toBe(false);
  });

  it('finds a bare name on PATH and nothing when PATH is unset', () => {
    expect(isOnPath('node')).toBe(true);
    expect(isOnPath('paqad-no-such-binary-xyz')).toBe(false);
    const saved = process.env.PATH;
    delete process.env.PATH;
    try {
      expect(isOnPath('node')).toBe(false);
    } finally {
      process.env.PATH = saved;
    }
  });

  it('lists only the binaries that are missing', () => {
    expect(missingBinaries(undefined)).toEqual([]);
    expect(missingBinaries([])).toEqual([]);
    expect(missingBinaries(['node', 'paqad-no-such-binary-xyz'])).toEqual([
      'paqad-no-such-binary-xyz',
    ]);
  });
});
