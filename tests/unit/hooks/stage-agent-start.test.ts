import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const HOOK = join(process.cwd(), 'runtime/hooks/stage-agent-start.mjs');
const COMPLETION_HOOK = join(process.cwd(), 'runtime/hooks/stage-agent-completion.mjs');
const CLI = join(process.cwd(), 'dist/cli/index.js');

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-stage-agent-start-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function onboard(root: string): string {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current\n', 'utf8');
  return root;
}

async function openFeature(root: string, session: string): Promise<void> {
  await execa('node', [CLI, 'stage', 'start', 'planning', '--title', 'seed', '--issue', '12'], {
    cwd: root,
    env: { SE_SESSION: session },
    reject: false,
  });
}

function hookEnv(root: string, extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: process.env.PATH ?? '', HOME: root, PAQAD_PROJECT_ROOT: root, ...extra };
}

async function runHook(
  root: string,
  payload: unknown,
  extra: Record<string, string> = {},
  hook = HOOK,
) {
  return execa('node', [hook], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: hookEnv(root, extra),
    extendEnv: false,
    reject: false,
  });
}

function markerDir(root: string): string {
  return join(root, '.paqad', 'session', 'agent-entry');
}

function markers(root: string): string[] {
  return existsSync(markerDir(root)) ? readdirSync(markerDir(root)) : [];
}

function hookLog(root: string): string[] {
  const path = join(root, '.paqad', 'logs', 'hooks.log');
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line.includes('stage-agent-start'))
    : [];
}

function stagePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'sub_abc',
    agent_id: 'agent_dev_1',
    agent_type: 'paqad-development',
    hook_event_name: 'SubagentStart',
    ...overrides,
  };
}

describe('stage-agent-start.mjs', () => {
  it('prints one SubagentStart brief with the resolved session and stamps the marker after', async () => {
    const root = onboard(tempRoot());
    await openFeature(root, 'ses_it');

    const result = await runHook(root, stagePayload());
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(Object.keys(output)).toEqual(['hookSpecificOutput']);
    expect(output.hookSpecificOutput.hookEventName).toBe('SubagentStart');
    const brief: string = output.hookSpecificOutput.additionalContext;
    expect(brief).toContain(
      'SE_SESSION=ses_it SE_AGENT_ID=agent_dev_1 paqad-ai stage start development',
    );
    expect(brief).toContain(
      'SE_SESSION=ses_it SE_AGENT_ID=agent_dev_1 paqad-ai stage end development --artifact',
    );
    expect(markers(root)).toEqual(['agent_dev_1']);
    expect(hookLog(root)).toHaveLength(1);
    expect(hookLog(root)[0]).toContain('seeded agent=agent_dev_1 stage=development');
  });

  it('records the running stage agent as one started stage-agent row in the open change', async () => {
    const root = onboard(tempRoot());
    await openFeature(root, 'ses_live');
    await runHook(root, stagePayload({ agent_type: 'paqad:paqad-planning' }));
    const base = join(root, '.paqad/ledger/feature-evidence');
    const bundle = readdirSync(base).find((name) => name !== '_session')!;
    const rows = readFileSync(join(base, bundle, 'stage-evidence.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const started = rows.filter((row) => row.kind === 'stage-agent');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      stage: 'planning',
      agent_id: 'agent_dev_1',
      event_status: 'started',
    });
  });

  it('gives the brief the same session the completion hook records its row under', async () => {
    const root = onboard(tempRoot());
    await openFeature(root, 'ses_orch');
    const payload = stagePayload({ session_id: 'sub_other' });

    const start = await runHook(root, payload, { SE_SESSION: 'ses_env_other' });
    const brief: string = JSON.parse(start.stdout).hookSpecificOutput.additionalContext;
    const session = brief.match(
      /SE_SESSION=(\S+) SE_AGENT_ID=agent_dev_1 paqad-ai stage start/,
    )?.[1];

    await runHook(
      root,
      { ...payload, hook_event_name: 'SubagentStop' },
      { SE_SESSION: 'ses_env_other' },
      COMPLETION_HOOK,
    );
    const base = join(root, '.paqad/ledger/feature-evidence');
    const bundle = readdirSync(base).find((name) => name !== '_session')!;
    const rows = readFileSync(join(base, bundle, 'stage-evidence.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const agentRows = rows.filter(
      (row) => row.kind === 'stage-agent' && row.event_status !== 'started',
    );
    expect(agentRows).toHaveLength(1);
    expect(session).toBe(agentRows[0].session_id);
    const started = rows.filter(
      (row) => row.kind === 'stage-agent' && row.event_status === 'started',
    );
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ session_id: session, agent_id: 'agent_dev_1' });
    expect(agentRows[0]).toMatchObject({ agent_id: 'agent_dev_1', event_status: 'completed' });
  });

  it.each(['paqad-expert', 'paqad:paqad-chief-architect', 'paqad-foo', 'Explore', undefined])(
    'prints nothing and stamps nothing for agent type %s',
    async (agentType) => {
      const root = onboard(tempRoot());
      const result = await runHook(root, stagePayload({ agent_type: agentType }));
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
      expect(markers(root)).toEqual([]);
      expect(hookLog(root)).toHaveLength(1);
      expect(hookLog(root)[0]).toContain('skipped agent=agent_dev_1 stage=none');
    },
  );

  it('prints the brief but stamps no marker when the agent id is missing', async () => {
    const root = onboard(tempRoot());
    const result = await runHook(root, stagePayload({ agent_id: undefined }));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.hookEventName).toBe('SubagentStart');
    expect(existsSync(markerDir(root))).toBe(false);
  });

  it('keeps a path-like agent id inside the marker directory', async () => {
    const root = onboard(tempRoot());
    const result = await runHook(root, stagePayload({ agent_id: '../../escape' }));
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).not.toContain(
      'SE_AGENT_ID',
    );
    expect(markers(root)).toEqual(['______escape']);
    expect(existsSync(join(root, '.paqad', 'escape'))).toBe(false);
    expect(existsSync(join(root, 'escape'))).toBe(false);
  });

  it('refuses a hostile session id: no brief, one failure line, no marker', async () => {
    const root = onboard(tempRoot());
    const result = await runHook(root, stagePayload({ session_id: 'x; rm -rf ~' }), {
      PAQAD_DEBUG_SECRET: 'unused',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(markers(root)).toEqual([]);
    const lines = hookLog(root);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('failed agent=agent_dev_1 stage=development: unsafe session id');
    expect(lines[0]).not.toContain('rm -rf');
  });

  it('never writes the brief or the payload into the log on a failure', async () => {
    const root = onboard(tempRoot());
    await runHook(
      root,
      stagePayload({ session_id: 'bad id', api_key: 'sk-live-SECRET-1234567890' }),
    );
    const lines = hookLog(root).join('\n');
    expect(lines).not.toContain('sk-live-SECRET');
    expect(lines).not.toContain('stage agent');
    expect(lines).not.toContain('bad id');
  });

  it('exits 0 silently with no marker when the compiled brief is missing', async () => {
    const root = onboard(tempRoot());
    const install = tempRoot();
    cpSync(join(process.cwd(), 'runtime/hooks'), join(install, 'runtime/hooks'), {
      recursive: true,
    });
    const result = await runHook(
      root,
      stagePayload(),
      {},
      join(install, 'runtime/hooks/stage-agent-start.mjs'),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(markers(root)).toEqual([]);
    const lines = hookLog(root);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('failed agent=agent_dev_1 stage=unknown');
  });

  it('does nothing when paqad is disabled or the repo was never onboarded', async () => {
    const disabled = onboard(tempRoot());
    const off = await runHook(disabled, stagePayload(), { PAQAD_DISABLED: '1' });
    expect(off.stdout).toBe('');
    expect(markers(disabled)).toEqual([]);
    expect(hookLog(disabled)).toEqual([]);

    const bare = tempRoot();
    const none = await runHook(bare, stagePayload());
    expect(none.exitCode).toBe(0);
    expect(none.stdout).toBe('');
    expect(existsSync(join(bare, '.paqad'))).toBe(false);
  });

  it('ignores a payload that is not JSON', async () => {
    const root = onboard(tempRoot());
    const result = await runHook(root, 'not json');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(hookLog(root)).toEqual([]);
  });

  it('lets exactly one install route seed a session', async () => {
    const root = onboard(tempRoot());
    const pluginRoot = tempRoot();
    const markerDirPath = join(root, '.paqad', 'session', 'plugin-active.d');
    mkdirSync(markerDirPath, { recursive: true });
    writeFileSync(
      join(markerDirPath, 'sub_abc'),
      JSON.stringify({ at: new Date().toISOString(), root: pluginRoot }),
      'utf8',
    );

    const npm = await runHook(root, stagePayload());
    expect(npm.stdout).toBe('');
    expect(markers(root)).toEqual([]);
    expect(hookLog(root)).toEqual([
      expect.stringContaining('stage-agent-start: stood-down agent=agent_dev_1 reason=npm'),
    ]);

    const plugin = await runHook(root, stagePayload(), { CLAUDE_PLUGIN_ROOT: pluginRoot });
    expect(JSON.parse(plugin.stdout).hookSpecificOutput.hookEventName).toBe('SubagentStart');
    expect(markers(root)).toEqual(['agent_dev_1']);
  });

  it('logs a passive stand-down when live npm hook lines own the hooks', async () => {
    const root = onboard(tempRoot());
    const pluginRoot = tempRoot();
    const npmHook = join(root, '.paqad-ai', 'current', 'hooks', 'stage-agent-completion.mjs');
    mkdirSync(join(npmHook, '..'), { recursive: true });
    writeFileSync(npmHook, '', 'utf8');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: { SubagentStop: [{ hooks: [{ type: 'command', command: `node "${npmHook}"` }] }] },
      }),
      'utf8',
    );

    const plugin = await runHook(root, stagePayload(), { CLAUDE_PLUGIN_ROOT: pluginRoot });

    expect(plugin.stdout).toBe('');
    expect(markers(root)).toEqual([]);
    expect(hookLog(root)).toEqual([
      expect.stringContaining('stage-agent-start: stood-down agent=agent_dev_1 reason=passive'),
    ]);
  });

  it('is executable and shipped as a tsup-built entry', () => {
    const tsup = readFileSync(join(process.cwd(), 'tsup.config.ts'), 'utf8');
    expect(tsup).toContain("'stage-isolation/stage-brief': 'src/stage-isolation/stage-brief.ts'");
    expect(existsSync(join(process.cwd(), 'dist/stage-isolation/stage-brief.js'))).toBe(true);
    expect(readFileSync(HOOK, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });
});
