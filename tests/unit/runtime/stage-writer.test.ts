import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// stage-writer.mjs is a NON-BLOCKING writer: it always exits 0 and never wedges
// the agent. These exercise the dist-less guards (paqad disabled, malformed
// payload); the record logic itself is covered by the src-side
// tests/unit/stage-evidence/live-writer.test.ts (coverage-counted).
const HOOK = resolve(__dirname, '../../../runtime/hooks/stage-writer.mjs');

function run(projectRoot: string, payload: unknown, env: NodeJS.ProcessEnv = {}) {
  try {
    const stdout = execFileSync('node', [HOOK], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: stdout.toString('utf8') };
  } catch (error) {
    const err = error as { status: number; stdout: Buffer; stderr: Buffer };
    return { status: err.status, stdout: err.stdout?.toString('utf8') ?? '' };
  }
}

describe('runtime/hooks/stage-writer.mjs (non-blocking writer guards)', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-stage-writer-hook-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('exits 0 and writes no ledger when paqad is disabled', () => {
    const result = run(
      projectRoot,
      {
        session_id: 'ses_x',
        tool_name: 'Edit',
        tool_input: { file_path: join(projectRoot, 'src/a.ts') },
      },
      { PAQAD_DISABLED: '1' },
    );
    expect(result.status).toBe(0);
    expect(existsSync(join(projectRoot, '.paqad/ledger'))).toBe(false);
  });

  it('exits 0 on a payload with no target path', () => {
    const result = run(projectRoot, { session_id: 'ses_x', tool_name: 'Bash', tool_input: {} });
    expect(result.status).toBe(0);
  });

  it('exits 0 on malformed (non-JSON) stdin', () => {
    const result = run(projectRoot, 'not json at all');
    expect(result.status).toBe(0);
  });
});
