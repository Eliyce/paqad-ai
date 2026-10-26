import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

describe('runtime/hooks/ticket-intake-prompt.mjs (branch carrying other work)', () => {
  let projectRoot: string;
  const g = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  const commit = (subject: string) => {
    writeFileSync(join(projectRoot, `${subject.replace(/\W+/g, '-')}.txt`), subject);
    g('add', '-A');
    g('commit', '-q', '-m', subject);
  };

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ticket-intake-branch-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@t.dev');
    g('config', 'user.name', 'T');
    commit('chore: base');
  });
  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('prints one amber branch line when the branch carries other tickets', () => {
    g('checkout', '-q', '-b', 'feat/ORD-470-contact-matching');
    commit('feat(ORD-470): match');
    commit('fix(ORD-471): trim');
    const before = g('rev-list', '--all');
    const result = run(projectRoot, { prompt: 'work on ORD-482 please' });
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n').filter((line) => line.includes('🟡 Branch'));
    expect(lines).toEqual([
      '🟡 Branch `feat/ORD-470-contact-matching` already carries 2 commits from tickets ORD-470, ORD-471 made before this change started. ' +
        'They ride along in this PR unless you split the branch yourself; paqad never moves commits.',
    ]);
    expect(result.stdout).toContain('intake fetch ORD-482');
    expect(g('rev-list', '--all')).toBe(before);
  });

  it('prints no branch line on a branch that holds only this ticket', () => {
    g('checkout', '-q', '-b', 'feat/ORD-482-matcher');
    commit('feat(ORD-482): first pass');
    const result = run(projectRoot, { prompt: 'continue ORD-482' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('intake fetch ORD-482');
    expect(result.stdout).not.toContain('🟡 Branch');
  });

  it('prints no branch line without a ticket in the prompt', () => {
    g('checkout', '-q', '-b', 'feat/ORD-470-contact-matching');
    commit('feat(ORD-470): match');
    const result = run(projectRoot, { prompt: 'tidy the matcher' });
    expect(result.stdout).toBe('');
  });
});
