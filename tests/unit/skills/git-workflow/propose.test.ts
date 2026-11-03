import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScript } from '../_helpers/run-script.js';
import {
  CANARY,
  OUTPUT_LIMIT_BYTES,
  SKILL,
  forwarded,
  run,
  sandbox,
  snapshot,
  type Sandbox,
} from './stub-cli.js';

const SCRIPT = 'propose.mjs';
const GOOD: string[] = [];

let box: Sandbox;

beforeEach(() => {
  box = sandbox();
});

afterEach(() => {
  box.cleanup();
});

describe('git-workflow propose.mjs contract', () => {
  it('propose help', () => {
    const result = run(box, SCRIPT, ['--help']);
    expect(result.status).toBe(0);
    for (const flag of ['--project-root', '--help']) expect(result.stdout).toContain(flag);
    expect(forwardedNothing(result.stdout)).toBe(true);
  });

  it('propose invalid input', () => {
    const result = run(box, SCRIPT, ['--apply']);
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout) as { error: string; expected: string };
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.expected).toMatch(/^Usage: propose.mjs/);
  });

  it('propose fixture output', () => {
    const result = run(box, SCRIPT, GOOD);
    expect(result.status).toBe(0);
    expect(forwarded(result)).toEqual(['git-workflow', 'setup']);
    expect(run(box, SCRIPT, GOOD, { STUB_EXIT: '1' }).status).toBe(1);
    expect(run(box, SCRIPT, GOOD, { STUB_EXIT: '2' }).status).toBe(2);
  });

  it('propose exits 2 when paqad-ai cannot start', () => {
    const empty = mkdtempSync(join(tmpdir(), 'git-workflow-nopath-'));
    try {
      const result = runScript(join(SKILL, 'scripts', SCRIPT), GOOD, {
        cwd: box.project,
        env: { PATH: empty },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('paqad-ai could not be started');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('propose idempotency', () => {
    const first = run(box, SCRIPT, GOOD);
    const second = run(box, SCRIPT, GOOD);
    expect(second.status).toBe(first.status);
    expect(second.stdout).toBe(first.stdout);
  });

  it('propose dry run', () => {
    const before = snapshot(box.project);
    const result = run(box, SCRIPT, []);
    expect(result.status).toBe(0);
    expect(snapshot(box.project)).toBe(before);
  });

  it('propose output size', () => {
    for (const args of [['--help'], GOOD, ['--apply']]) {
      expect(Buffer.byteLength(run(box, SCRIPT, args).stdout)).toBeLessThan(OUTPUT_LIMIT_BYTES);
    }
  });

  it('propose secrets', () => {
    for (const args of [['--help'], GOOD, ['--apply']]) {
      const result = run(box, SCRIPT, args, { GH_TOKEN: CANARY, GITHUB_TOKEN: CANARY });
      expect(result.stdout + result.stderr).not.toContain(CANARY);
    }
  });
});

function forwardedNothing(stdout: string): boolean {
  return !stdout.includes('"argv"');
}
