import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ticketRef } from '../../shared/ticket-ref.js';

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

  it('prints no ticket-intake line for a slash command', () => {
    const result = run(projectRoot, {
      prompt: `/claude-api managed-agents-onboard ${ticketRef(409)}`,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints no ticket-intake line for a Desktop banner-led notice', () => {
    const payload = {
      prompt: [
        '[SYSTEM NOTIFICATION - NOT USER INPUT]',
        '<task-notification>',
        `<summary>Background agent finished reviewing ${ticketRef(409)} and ${ticketRef(582)}</summary>`,
        '</task-notification>',
      ].join('\n'),
    };
    const result = run(projectRoot, payload);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints no ticket-intake line for a foreground agent-message hand-back', () => {
    const payload = {
      prompt: [
        '<system-reminder id="r1">',
        'Another Claude session sent a message while you were working:',
        '<agent-message from="a1b2c3">',
        '  [Subagent hand-back] The text below is the final report of a subagent.',
        `  Fixed the routing for ${ticketRef(623)} and checked ${ticketRef(582)}.`,
        '</agent-message>',
        '&lt;/system-reminder&gt;',
      ].join('\n'),
    };
    const result = run(projectRoot, payload);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('prints no ticket-intake line for a hand-back whose report comes first', () => {
    const payload = {
      prompt: [
        `Status: completed. Fixed the routing for ${ticketRef(623)} and checked ${ticketRef(582)}.`,
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
