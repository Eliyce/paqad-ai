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

// Step 5a — the on-entry narration line. Needs the dist bundle the hook lazy-imports,
// so it is gated on the build (CI builds before running the suite; a bare `vitest run`
// without a build skips it). The narration LOGIC is covered src-side in
// tests/unit/stage-evidence/narration.test.ts.
const DIST_NARRATION = resolve(__dirname, '../../../dist/stage-evidence/narration.js');
const hasDist = existsSync(DIST_NARRATION);

describe.skipIf(!hasDist)('runtime/hooks/stage-writer.mjs — on-entry narration (Step 5a)', () => {
  let projectRoot: string;
  const SES = 'ses_narr_hook';
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-stage-writer-narr-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  function edit(path: string) {
    return run(projectRoot, {
      session_id: SES,
      tool_name: 'Edit',
      tool_input: { file_path: join(projectRoot, path) },
    });
  }

  it('prints "▸ paqad · <stage>" the first time a change enters a stage, exit 0', () => {
    const result = edit('src/a.ts');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('building it to the spec');
    expect(result.stdout).toContain('systemMessage');
  });

  it('does not re-print within the same stage (idempotent)', () => {
    edit('src/a.ts'); // records development + prints
    const second = edit('src/b.ts'); // same stage → no new line
    expect(second.status).toBe(0);
    expect(second.stdout).not.toContain('building it to the spec');
  });
});
