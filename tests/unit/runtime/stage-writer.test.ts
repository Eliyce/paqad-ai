import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { recordMarkedStage } from '@/stage-evidence/live-writer.js';
import { currentFeature, foldFeature } from '@/feature-evidence/stage-ledger.js';

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

// The on-entry stage record. The hook lazy-imports the compiled live-writer, so these
// are gated on the build (CI builds before running the suite; a bare `vitest run`
// without a build skips them). The record LOGIC is covered src-side in
// tests/unit/stage-evidence/live-writer.test.ts.
//
// Regression guard for the PreToolUse `{systemMessage}` leak: the writer USED to print a
// "▸ paqad · <stage>" line via a top-level `{systemMessage}`, on the (now-false) premise
// that a PreToolUse `{systemMessage}` was invisible on Desktop. Claude Code now renders it
// as a literal "PreToolUse:<Tool> says:" line, so the writer no longer prints ANY
// systemMessage — the model speaks the narration. The ledger write must still happen.
const DIST_LIVE_WRITER = resolve(__dirname, '../../../dist/stage-evidence/live-writer.js');
const hasDist = existsSync(DIST_LIVE_WRITER);

describe.skipIf(!hasDist)('runtime/hooks/stage-writer.mjs — on-entry record, no chat leak', () => {
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

  /** Record planning + specification (issue #310) so the writer no longer defers a
   *  code edit — a stage is only recorded once the workflow's pre-code stages exist. */
  function seedPreCode() {
    recordMarkedStage(projectRoot, { sessionId: SES, stage: 'planning', phase: 'start' });
    recordMarkedStage(projectRoot, { sessionId: SES, stage: 'planning', phase: 'end' });
    recordMarkedStage(projectRoot, { sessionId: SES, stage: 'specification', phase: 'start' });
    recordMarkedStage(projectRoot, { sessionId: SES, stage: 'specification', phase: 'end' });
  }

  it('#310: prints nothing for a code edit before the pre-code stages are recorded (defer)', () => {
    const result = edit('src/a.ts');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('writes NO systemMessage the first time a change enters a stage (no chat leak), exit 0', () => {
    seedPreCode();
    const result = edit('src/a.ts');
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('systemMessage');
    expect(result.stdout).not.toContain('building it to the spec');
    expect(result.stdout).toBe('');
  });

  it('still records the development stage in the ledger despite emitting no narration (INV-2)', () => {
    seedPreCode();
    const result = edit('src/a.ts');
    expect(result.status).toBe(0);
    // The hook subprocess wrote the ledger via the compiled live-writer; the stage
    // record is present even though nothing was printed to chat.
    const dir = currentFeature(projectRoot, SES);
    expect(dir).toBeTruthy();
    const fold = foldFeature(projectRoot, SES, dir!);
    expect(fold.stages.some((stage) => stage.stage === 'development')).toBe(true);
  });
});
