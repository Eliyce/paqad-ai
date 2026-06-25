import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Issue #220 — when paqad is disabled (PAQAD_DISABLED=1 or paqad_enable=false in
// .paqad/.config), every shell gate must be a pure no-op: exit 0, never block, and
// the prompt gate must NOT inject its `[paqad]` reminder on stdout (which would
// contaminate the OFF arm of an A/B comparison).

const ENTRY_GATE = resolve(__dirname, '../../../runtime/hooks/agent-entry-gate.sh');
const PROMPT_GATE = resolve(__dirname, '../../../runtime/hooks/agent-entry-prompt-gate.sh');
const DECISION_GATE = resolve(__dirname, '../../../runtime/hooks/decision-pause-gate.sh');

/** The durable local off-signal: paqad_enable=false in `.paqad/.config`. */
const DISABLED_CONFIG = 'paqad_enable=false\n';

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(script: string, root: string, extraEnv: Record<string, string> = {}): RunResult {
  try {
    const stdout = execFileSync('bash', [script], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: stdout.toString('utf8'), stderr: '' };
  } catch (error) {
    const err = error as { status: number; stdout: Buffer; stderr: Buffer };
    return {
      status: err.status,
      stdout: err.stdout?.toString('utf8') ?? '',
      stderr: err.stderr?.toString('utf8') ?? '',
    };
  }
}

describe('shell gates are a no-op when paqad is disabled', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-disabled-gate-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    mkdirSync(join(root, 'docs/instructions'), { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), '# entry');
    writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
    // No sentinel: the gates WOULD block here if paqad were enabled.
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('control: the entry gate blocks (exit 2) when enabled and the sentinel is missing', () => {
    expect(run(ENTRY_GATE, root).status).toBe(2);
  });

  it('entry gate exits 0 with PAQAD_DISABLED=1', () => {
    const result = run(ENTRY_GATE, root, { PAQAD_DISABLED: '1' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('entry gate exits 0 with paqad_enable=false in .config', () => {
    writeFileSync(join(root, '.paqad/.config'), DISABLED_CONFIG);
    const result = run(ENTRY_GATE, root);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('prompt gate (soft) exits 0 AND injects no [paqad] stdout when disabled', () => {
    const viaEnv = run(PROMPT_GATE, root, { PAQAD_DISABLED: '1' });
    expect(viaEnv.status).toBe(0);
    expect(viaEnv.stdout).toBe('');

    writeFileSync(join(root, '.paqad/.config'), DISABLED_CONFIG);
    const viaConfig = run(PROMPT_GATE, root);
    expect(viaConfig.status).toBe(0);
    expect(viaConfig.stdout).toBe('');
  });

  it('prompt gate (hard) exits 0 and stays silent when disabled', () => {
    const result = run(PROMPT_GATE, root, { PAQAD_DISABLED: '1', PAQAD_AGENT_ENTRY_MODE: 'hard' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('decision-pause gate exits 0 even with a pending packet when disabled', () => {
    mkdirSync(join(root, '.paqad/decisions/pending'), { recursive: true });
    writeFileSync(join(root, '.paqad/decisions/pending/D-test.json'), '{}');

    // Control: blocks when enabled.
    expect(run(DECISION_GATE, root).status).toBe(2);

    const result = run(DECISION_GATE, root, { PAQAD_DISABLED: '1' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
