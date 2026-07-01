import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// stage-marker-parse.mjs is a non-blocking Stop hook: always exits 0. These check
// the dist-less guards (disabled, no transcript_path); the parse logic is covered
// by tests/unit/stage-evidence/marker-parse.test.ts.
const HOOK = resolve(__dirname, '../../../runtime/hooks/stage-marker-parse.mjs');

function run(projectRoot: string, payload: unknown, env: NodeJS.ProcessEnv = {}) {
  try {
    execFileSync('node', [HOOK], {
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

describe('runtime/hooks/stage-marker-parse.mjs (guards)', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-marker-hook-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  it('exits 0 when disabled', () => {
    expect(
      run(projectRoot, { session_id: 's', transcript_path: '/x' }, { PAQAD_DISABLED: '1' }),
    ).toBe(0);
  });

  it('exits 0 when the payload has no transcript_path', () => {
    expect(run(projectRoot, { session_id: 's' })).toBe(0);
  });
});
