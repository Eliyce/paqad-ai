import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// ticket-intake-prompt.mjs is advisory and NON-BLOCKING: it always exits 0 and prints at most
// one `▸ paqad` intake line. These exercise the observable guard behavior (exit 0 + no output);
// the matcher logic itself (banner / element recognition) is covered at the TS level in
// tests/unit/pipeline/prompt-lane.test.ts, and the dist import paths by
// tests/unit/runtime/hook-dist-entry-parity.test.ts. In a fresh checkout dist/ is absent, so the
// dist-dependent branches fall through their import guard to a clean exit 0 — which is exactly the
// "no output" contract a system notice / slash command must honor (issue #615, Parts 2 + 5).
const HOOK = resolve(__dirname, '../../../runtime/hooks/ticket-intake-prompt.mjs');

function run(projectRoot: string, payload: unknown, env: NodeJS.ProcessEnv = {}) {
  try {
    const stdout = execFileSync('node', [HOOK], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout: stdout.toString('utf8') };
  } catch (error) {
    const err = error as { status: number; stdout: Buffer };
    return { status: err.status, stdout: err.stdout?.toString('utf8') ?? '' };
  }
}

describe('runtime/hooks/ticket-intake-prompt.mjs (advisory guards)', () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ticket-intake-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('exits 0 with no output when paqad is disabled', () => {
    const result = run(projectRoot, { prompt: 'fix PROJ-123' }, { PAQAD_DISABLED: '1' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 with no output on malformed stdin', () => {
    const result = run(projectRoot, 'not json');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 with no output when there is no prompt', () => {
    const result = run(projectRoot, { session_id: 'x' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints no ticket-intake line for a slash command (issue #615, Part 5)', () => {
    // Dist-less guard: a '/'-prefixed prompt is suppressed before any dist import, so this holds
    // even in a fresh checkout where dist/ is absent.
    const result = run(projectRoot, { prompt: '/claude-api managed-agents-onboard #409' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints no ticket-intake line for a Desktop banner-led notice (issue #615, Part 2)', () => {
    const payload = {
      prompt: [
        '[SYSTEM NOTIFICATION - NOT USER INPUT]',
        '<task-notification>',
        '<summary>Background agent finished reviewing #409 and #582</summary>',
        '</task-notification>',
      ].join('\n'),
    };
    const result = run(projectRoot, payload);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints no ticket-intake line for a foreground agent-message hand-back (issue #623)', () => {
    const payload = {
      prompt: [
        '<system-reminder id="r1">',
        'Another Claude session sent a message while you were working:',
        '<agent-message from="a1b2c3">',
        '  [Subagent hand-back] The text below is the final report of a subagent.',
        '  Fixed the routing for #623 and checked #582.',
        '</agent-message>',
        '&lt;/system-reminder&gt;',
      ].join('\n'),
    };
    const result = run(projectRoot, payload);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints no ticket-intake line for a hand-back whose report comes first (issue #623)', () => {
    // A subagent's report leads, naming issues, and the banner and element follow it.
    const payload = {
      prompt: [
        'Status: completed. Fixed the routing for #623 and checked #582.',
        '',
        '[SYSTEM NOTIFICATION - NOT USER INPUT]',
        'This is an automated background-task event, NOT a message from the user.',
        '',
        '<task-notification>',
        '<task-id>a1b2c3</task-id>',
        '<summary>Agent "paqad-development" finished</summary>',
        '</task-notification>',
      ].join('\n'),
    };
    const result = run(projectRoot, payload);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
