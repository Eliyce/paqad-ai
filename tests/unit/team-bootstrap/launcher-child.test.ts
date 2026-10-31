import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type Sandbox,
  LAUNCHER,
  fakeDeps,
  loadLauncher,
  makeSandbox,
  payload,
  writeCopy,
} from './helpers';

let sandbox: Sandbox;
let launcherCopy: string;
let hookLog: string;

beforeEach(() => {
  sandbox = makeSandbox();
  launcherCopy = join(sandbox.project, '.paqad', 'hook.mjs');
  copyFileSync(LAUNCHER, launcherCopy);
  hookLog = join(sandbox.home, 'hook-log.jsonl');
  writeCopy(join(sandbox.home, '.paqad-ai', 'team-plugin'));
});
afterEach(() => {
  sandbox.cleanup();
});

interface HookRecord {
  script: string;
  args: string[];
  input: string;
  pluginRoot: string | null;
  pluginData: string | null;
  rag: string | null;
}

function runReal(
  argv: string[],
  input: string | Buffer,
  extraEnv: NodeJS.ProcessEnv = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [launcherCopy, ...argv], {
    input,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: sandbox.home,
      USERPROFILE: sandbox.home,
      CLAUDE_PROJECT_DIR: sandbox.project,
      FAKE_HOOK_LOG: hookLog,
      ...extraEnv,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function records(): HookRecord[] {
  if (!existsSync(hookLog)) return [];
  return readFileSync(hookLog, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as HookRecord);
}

const edit = (sid = 'ses-child'): string =>
  JSON.stringify({ session_id: sid, hook_event_name: 'PreToolUse', tool_name: 'Edit' });

describe('the launcher runs the copy like an installed plugin', () => {
  it('passes the plugin env and stdin byte for byte', () => {
    const input = Buffer.from(`${edit()}\né中 \u0000tail`, 'utf8');
    const result = runReal(['capability-gate.mjs', 'pre-mutation'], input);
    expect(result.status).toBe(0);
    const [record] = records();
    expect(record).toMatchObject({
      script: 'capability-gate.mjs',
      args: ['pre-mutation'],
      pluginRoot: join(sandbox.home, '.paqad-ai', 'team-plugin'),
      pluginData: join(sandbox.home, '.paqad-ai', 'team-plugin-data'),
      rag: null,
    });
    expect(Buffer.from(record!.input, 'utf8').equals(input)).toBe(true);
  });

  it.each([
    ['PreToolUse', 0, 0],
    ['PreToolUse', 2, 2],
    ['PreToolUse', 1, 2],
    ['PreToolUse', 7, 2],
    ['Stop', 0, 0],
    ['Stop', 2, 2],
    ['Stop', 1, 1],
  ])('on %s a child exit of %i gives %i', (event, childExit, expected) => {
    const script = event === 'Stop' ? 'verification-completion.mjs' : 'agent-entry-gate.mjs';
    const input = JSON.stringify({ session_id: 'ses-exit', hook_event_name: event });
    const result = runReal([script], input, { FAKE_HOOK_EXIT: String(childExit) });
    expect(result.status).toBe(expected);
  });

  it('runs plugin-session-start before agent-entry-session-start and never silent-update', () => {
    const start = JSON.stringify({ session_id: 'ses-start', hook_event_name: 'SessionStart' });
    expect(runReal(['agent-entry-session-start.mjs'], start).status).toBe(0);
    expect(runReal(['silent-update.mjs'], start).status).toBe(0);
    expect(records().map((r) => r.script)).toEqual([
      'plugin-session-start.mjs',
      'agent-entry-session-start.mjs',
    ]);
    expect(records().every((r) => r.input === start)).toBe(true);
  });
});

describe('cloud sessions', () => {
  it('turn RAG off through the env, once in CLAUDE_ENV_FILE, with the cloud setup line', async () => {
    const envFile = join(sandbox.home, 'claude-env');
    writeFileSync(envFile, 'PATH=/x');
    const start = JSON.stringify({ session_id: 'ses-cloud', hook_event_name: 'SessionStart' });
    const cloud = { CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile };
    runReal(['agent-entry-session-start.mjs'], start, cloud);
    runReal(['agent-entry-session-start.mjs'], start, cloud);
    runReal(['agent-entry-gate.mjs'], edit('ses-cloud'), cloud);
    expect(records().every((r) => r.rag === 'false')).toBe(true);
    const lines = readFileSync(envFile, 'utf8').split('\n');
    expect(lines.filter((line) => line === 'PAQAD_RAG_ENABLED=false')).toHaveLength(1);
    expect(lines[0]).toBe('PATH=/x');

    const launcher = (await loadLauncher()) as unknown as {
      setupMessage: (env: NodeJS.ProcessEnv) => string;
    };
    expect(launcher.setupMessage({ CLAUDE_CODE_REMOTE: 'true' })).toBe(
      '{"systemMessage": "Setting up paqad for this cloud session."}\n',
    );
    expect(launcher.setupMessage({})).toBe(
      '{"systemMessage": "Setting up paqad for this repo (one time)."}\n',
    );
  });

  it('laptops keep the team RAG setting', () => {
    runReal(['agent-entry-gate.mjs'], edit(), { CLAUDE_CODE_REMOTE: 'false' });
    expect(records()[0]!.rag).toBeNull();
  });
});

describe('a missing or unstartable hook', () => {
  it('a copy missing the named script blocks PreToolUse with one sentence and passes Stop', () => {
    const hooks = join(sandbox.home, '.paqad-ai', 'team-plugin', 'runtime', 'hooks');
    rmSync(join(hooks, 'stage-writer.mjs'));
    rmSync(join(hooks, 'verification-completion.mjs'));
    const blocked = runReal(['stage-writer.mjs'], edit());
    expect(blocked.status).toBe(2);
    expect(blocked.stderr.trim().split('\n')).toHaveLength(1);
    expect(blocked.stderr).toContain('the lead must run `paqad-ai update`');
    const stop = runReal(
      ['verification-completion.mjs'],
      JSON.stringify({ session_id: 'ses-x', hook_event_name: 'Stop' }),
    );
    expect(stop.status).toBe(0);
    expect(records()).toEqual([]);
  });

  it.each([
    ['PreToolUse', 2],
    ['Stop', 0],
    ['UserPromptSubmit', 0],
  ])('a child that cannot start on %s exits %i', async (event, expected) => {
    const launcher = await loadLauncher();
    for (const failure of [{ error: new Error('spawn failed') }, { status: null }, undefined]) {
      const { deps } = fakeDeps(sandbox, {
        readStdin: () => payload(event),
        spawnSync: () => failure,
      });
      expect(launcher.runLauncher(['agent-entry-gate.mjs'], {}, deps)).toBe(expected);
    }
  });

  it('an unexpected launcher error blocks PreToolUse and passes other events', async () => {
    const launcher = await loadLauncher();
    for (const [event, expected] of [
      ['PreToolUse', 2],
      ['Stop', 0],
    ] as const) {
      const { deps } = fakeDeps(sandbox, {
        readStdin: () => payload(event),
        spawnSync: () => {
          throw new Error('boom');
        },
      });
      expect(launcher.runLauncher(['agent-entry-gate.mjs'], {}, deps)).toBe(expected);
    }
    expect(readFileSync(join(sandbox.project, '.paqad/logs/hooks.log'), 'utf8')).toContain(
      'launcher error',
    );
  });

  it('infers the event from the script when the payload has none', async () => {
    const launcher = (await loadLauncher()) as unknown as {
      inferEvent: (payload: unknown, script: string, args: string[]) => string;
    };
    expect(launcher.inferEvent(undefined, 'capability-gate.mjs', ['pre-mutation'])).toBe(
      'PreToolUse',
    );
    expect(launcher.inferEvent(undefined, 'capability-gate.mjs', ['completion'])).toBe('Stop');
    expect(launcher.inferEvent({}, 'agent-entry-gate.mjs', [])).toBe('PreToolUse');
    expect(launcher.inferEvent({}, 'unknown.mjs', [])).toBe('');
    expect(launcher.inferEvent({ hook_event_name: 'Stop' }, 'agent-entry-gate.mjs', [])).toBe(
      'Stop',
    );
    const malformed = runReal(['agent-entry-gate.mjs'], 'not-json-at-all', { FAKE_HOOK_EXIT: '2' });
    expect(malformed.status).toBe(2);
  });
});
