import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CLOUD_HUD_LINE,
  HEARTBEAT_WINDOW_MS,
  HUD_NOT_ATTACHED_NOTE,
  PLUGIN_RELOAD_LINE,
  QUIET_NARRATION_LINE,
  SNAPSHOT_FRESH_MS,
  cloudHudLine,
  heartbeatIsFresh,
  heartbeatPath,
  pluginMigrateMarkPath,
  pluginReloadLine,
  quietNarration,
  recordHudAttachment,
  snapshotIsFresh,
  unattachedPath,
} from '../../../runtime/hooks/lib/hud-heartbeat.mjs';

import { NO_CONTEXT_REFRESH_ENV, removeTempProject } from './temp-project.js';

const PROMPT_GATE = resolve(__dirname, '../../../runtime/hooks/agent-entry-prompt-gate.mjs');
const SESSION = 'ses-live';

let root: string;

function beat(sessionId: string, at: number): void {
  const path = heartbeatPath(root, sessionId);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '{}');
  utimesSync(path, new Date(at), new Date(at));
}

function hudSnapshot(sessionId: string, body: unknown): void {
  const path = join(root, '.paqad/session/hud', `${sessionId}.json`);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
}

const QUALIFIED = { active: true, scope: { qualified: true, reason: 'qualified' } };

function gate(sessionId = SESSION, adapter?: string): string {
  const args = adapter ? [PROMPT_GATE, adapter] : [PROMPT_GATE];
  return execFileSync('node', args, {
    env: {
      ...process.env,
      ...NO_CONTEXT_REFRESH_ENV,
      CLAUDE_PROJECT_DIR: root,
      CLAUDE_CODE_REMOTE: '',
    },
    input: JSON.stringify({ prompt: '', session_id: sessionId }),
  }).toString('utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-heartbeat-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'docs/instructions'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), '# entry');
  writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
});

afterEach(() => removeTempProject(root));

describe('heartbeat freshness', () => {
  const NOW = Date.parse('2026-10-18T09:00:00.000Z');

  it('is fresh inside the window and exactly at its edge', () => {
    beat(SESSION, NOW - 5_000);
    expect(heartbeatIsFresh(root, SESSION, NOW)).toBe(true);
    beat(SESSION, NOW - HEARTBEAT_WINDOW_MS);
    expect(heartbeatIsFresh(root, SESSION, NOW)).toBe(true);
  });

  it('is absent just past the edge, one second past it, from the future or missing', () => {
    beat(SESSION, NOW - HEARTBEAT_WINDOW_MS);
    expect(heartbeatIsFresh(root, SESSION, NOW + 1)).toBe(false);
    expect(heartbeatIsFresh(root, SESSION, NOW + 1_000)).toBe(false);
    beat(SESSION, NOW + 10_000);
    expect(heartbeatIsFresh(root, SESSION, NOW)).toBe(false);
    expect(heartbeatIsFresh(root, 'ses-missing', NOW)).toBe(false);
    expect(heartbeatIsFresh(root, '', NOW)).toBe(false);
    expect(heartbeatIsFresh(root, null as never, NOW)).toBe(false);
  });

  it('reads only the current session heartbeat, under a filename-safe id', () => {
    beat('ses-other', NOW);
    expect(heartbeatIsFresh(root, SESSION, NOW)).toBe(false);
    expect(heartbeatPath(root, '../a b')).toBe(join(root, '.paqad/session/hud/__a_b.live'));
  });

  it('adds the line only on Claude Code, and never throws', () => {
    beat(SESSION, NOW);
    hudSnapshot(SESSION, QUALIFIED);
    expect(quietNarration(root, SESSION, undefined, NOW)).toBe(`${QUIET_NARRATION_LINE}\n`);
    expect(quietNarration(root, SESSION, 'claude-code', NOW)).toBe(`${QUIET_NARRATION_LINE}\n`);
    expect(quietNarration(root, SESSION, 'codex-cli', NOW)).toBe('');
    expect(quietNarration(root, SESSION, 'gemini-cli', NOW)).toBe('');
    expect(quietNarration(`${root}\0bad`, SESSION, undefined, NOW)).toBe('');
  });
});

describe('the quiet line needs a HUD that draws a change', () => {
  const NOW = Date.parse('2026-10-18T09:00:00.000Z');

  it('AC-12: gives no line when the snapshot has no qualified change', () => {
    beat(SESSION, NOW);
    hudSnapshot(SESSION, { active: false, scope: { qualified: false, reason: 'other-branch' } });
    expect(quietNarration(root, SESSION, 'claude-code', NOW)).toBe('');
  });

  it('AC-12: gives the line when the snapshot has a qualified change', () => {
    beat(SESSION, NOW);
    hudSnapshot(SESSION, QUALIFIED);
    expect(quietNarration(root, SESSION, 'claude-code', NOW)).toBe(`${QUIET_NARRATION_LINE}\n`);
  });

  it('AC-12: gives no line with no snapshot, an unreadable one, or another session qualified', () => {
    beat(SESSION, NOW);
    expect(quietNarration(root, SESSION, 'claude-code', NOW)).toBe('');
    hudSnapshot(SESSION, '{not json');
    expect(quietNarration(root, SESSION, 'claude-code', NOW)).toBe('');
    hudSnapshot(SESSION, { active: true });
    expect(quietNarration(root, SESSION, 'claude-code', NOW)).toBe('');
    hudSnapshot(SESSION, { scope: { qualified: false } });
    hudSnapshot('ses-other', QUALIFIED);
    expect(quietNarration(root, SESSION, 'claude-code', NOW)).toBe('');
  });

  it('gives no line for a qualified snapshot when the heartbeat is stale', () => {
    beat(SESSION, NOW - HEARTBEAT_WINDOW_MS - 1_000);
    hudSnapshot(SESSION, QUALIFIED);
    expect(quietNarration(root, SESSION, 'claude-code', NOW)).toBe('');
  });
});

describe('the prompt gate and the heartbeat', () => {
  beforeEach(() => {
    const sentinel = join(root, '.paqad/.agent-entry-loaded.d', SESSION);
    mkdirSync(join(sentinel, '..'), { recursive: true });
    writeFileSync(sentinel, '{"loaded_at":"now"}');
    const future = new Date(Date.now() + 60_000);
    utimesSync(sentinel, future, future);
  });

  it('AC-43: adds exactly one quiet line for a fresh heartbeat of this session', () => {
    const before = gate();
    hudSnapshot(SESSION, QUALIFIED);
    beat(SESSION, Date.now());
    const after = gate();
    expect(after.split(QUIET_NARRATION_LINE)).toHaveLength(2);
    expect(after.replace(`${QUIET_NARRATION_LINE}\n`, '')).toBe(before);
  });

  it('AC-43: is byte-identical with another session heartbeat, a stale one or none', () => {
    hudSnapshot(SESSION, QUALIFIED);
    expect(gate()).toContain('HUD not attached'); // AC-28: said once, on the first such prompt
    const none = gate();
    beat('ses-other', Date.now());
    expect(gate()).toBe(none);
    beat(SESSION, Date.now() - HEARTBEAT_WINDOW_MS - 1_000);
    expect(gate()).toBe(none);
  });

  it('AC-42: drops the line once the heartbeat goes stale mid-session', () => {
    hudSnapshot(SESSION, QUALIFIED);
    beat(SESSION, Date.now());
    expect(gate()).toContain(QUIET_NARRATION_LINE);
    beat(SESSION, Date.now() - 10 * 60_000);
    expect(gate()).not.toContain(QUIET_NARRATION_LINE);
  });

  it('leaves other hosts unchanged', () => {
    hudSnapshot(SESSION, QUALIFIED);
    const none = gate(SESSION, 'codex-cli');
    beat(SESSION, Date.now());
    expect(gate(SESSION, 'codex-cli')).toBe(none);
  });
});

describe('HUD not attached is recorded once per session (W5)', () => {
  const NOW = Date.parse('2026-10-18T09:00:00.000Z');
  const LOCAL = { CLAUDE_CODE_REMOTE: '' } as NodeJS.ProcessEnv;
  const S = 'ses-unattached';

  function snapshotAt(at: number): void {
    hudSnapshot(S, { scope: { qualified: false } });
    const path = join(root, '.paqad/session/hud', `${S}.json`);
    utimesSync(path, new Date(at), new Date(at));
  }

  const record = (now: number) => recordHudAttachment(root, S, { env: LOCAL, now });

  it('AC-28: a just-fresh snapshot and a missing heartbeat write one record and one hooks.log line', () => {
    snapshotAt(NOW - SNAPSHOT_FRESH_MS);
    expect(snapshotIsFresh(root, S, NOW)).toBe(true);
    expect(record(NOW)).toContain(HUD_NOT_ATTACHED_NOTE);
    expect(existsSync(unattachedPath(root, S))).toBe(true);
    expect(record(NOW + 1_000)).toBe('');
    const log = readFileSync(join(root, '.paqad/logs/hooks.log'), 'utf8');
    expect(log.split(HUD_NOT_ATTACHED_NOTE)).toHaveLength(2);
  });

  it('AC-28: a just-stale heartbeat counts as missing, a heartbeat at the edge clears the record', () => {
    snapshotAt(NOW - 1_000);
    beat(S, NOW - HEARTBEAT_WINDOW_MS - 1);
    expect(record(NOW)).toContain('HUD not attached');
    beat(S, NOW - HEARTBEAT_WINDOW_MS);
    expect(record(NOW)).toBe('');
    expect(existsSync(unattachedPath(root, S))).toBe(false);
  });

  it('AC-28: a just-stale snapshot, or none, records nothing', () => {
    expect(record(NOW)).toBe('');
    snapshotAt(NOW - SNAPSHOT_FRESH_MS - 1);
    expect(record(NOW)).toBe('');
    expect(existsSync(unattachedPath(root, S))).toBe(false);
  });

  it('AC-28: cloud, headless and other adapters record nothing', () => {
    snapshotAt(NOW - 1_000);
    expect(recordHudAttachment(root, S, { env: { CLAUDE_CODE_REMOTE: 'true' }, now: NOW })).toBe(
      '',
    );
    expect(recordHudAttachment(root, S, { env: { CI: '1' }, now: NOW })).toBe('');
    expect(recordHudAttachment(root, S, { env: LOCAL, now: NOW, adapter: 'codex-cli' })).toBe('');
    expect(existsSync(unattachedPath(root, S))).toBe(false);
  });

  it('AC-8: the cloud line is said once per cloud session and never locally', () => {
    const cloud = { CLAUDE_CODE_REMOTE: 'true' } as NodeJS.ProcessEnv;
    expect(cloudHudLine(root, S, LOCAL, NOW)).toBe('');
    expect(cloudHudLine(root, S, cloud, NOW)).toBe(`[paqad] ${CLOUD_HUD_LINE}\n`);
    expect(cloudHudLine(root, S, cloud, NOW)).toBe('');
  });
});

describe('AC-7: the reload line after a mid-session plugin install', () => {
  let home: string;
  const T = Date.UTC(2026, 10, 16, 12, 0, 0);

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'paqad-reload-home-'));
  });
  afterEach(() => removeTempProject(home));

  function markStarted(sessionId: string, at: number): void {
    const path = pluginMigrateMarkPath(root, sessionId);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, new Date(at).toISOString());
    utimesSync(path, new Date(at), new Date(at));
  }

  function migration(state: string, installedAt?: number): void {
    mkdirSync(join(home, '.paqad-ai'), { recursive: true });
    writeFileSync(
      join(home, '.paqad-ai', 'plugin-migration.json'),
      JSON.stringify({
        state,
        attempts: 1,
        version: '1',
        ...(installedAt === undefined ? {} : { installed_at: new Date(installedAt).toISOString() }),
      }),
    );
  }

  const line = (sessionId = SESSION, env: NodeJS.ProcessEnv = {}): string =>
    pluginReloadLine(root, sessionId, { home, env, now: T + 60_000 });

  it('says type /reload-plugins once after the install this session started', () => {
    markStarted(SESSION, T);
    migration('installed', T + 30_000);
    expect(line()).toBe(`[paqad] ${PLUGIN_RELOAD_LINE}\n`);
    expect(PLUGIN_RELOAD_LINE).toContain(
      'type /reload-plugins to see the HUD now, or it shows next session',
    );
    expect(line()).toBe('');
  });

  it('says nothing once the band has drawn', () => {
    markStarted(SESSION, T);
    migration('installed', T + 30_000);
    beat(SESSION, T + 40_000);
    expect(line()).toBe('');
  });

  it('says nothing while the install has not finished, failed, or predates this session', () => {
    markStarted(SESSION, T);
    expect(line()).toBe('');
    migration('failed');
    expect(line()).toBe('');
    migration('installed', T - 3_600_000);
    expect(line()).toBe('');
  });

  it('says nothing when this session started no install, or in a cloud session', () => {
    migration('installed', T + 30_000);
    expect(line()).toBe('');
    markStarted(SESSION, T);
    expect(line(SESSION, { CLAUDE_CODE_REMOTE: 'true' })).toBe('');
    expect(line('')).toBe('');
  });

  it('the prompt gate carries the line on the next prompt', () => {
    markStarted(SESSION, Date.now() - 60_000);
    migration('installed', Date.now() - 30_000);
    const out = execFileSync('node', [PROMPT_GATE], {
      env: {
        ...process.env,
        ...NO_CONTEXT_REFRESH_ENV,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_PROJECT_DIR: root,
        CLAUDE_CODE_REMOTE: '',
      },
      input: JSON.stringify({ prompt: '', session_id: SESSION }),
    }).toString('utf8');
    expect(out).toContain(PLUGIN_RELOAD_LINE);
  });
});
