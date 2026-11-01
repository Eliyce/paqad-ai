import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  agentNameFromPayload,
  delegationFromPayload,
  pruneDelegationText,
} from '../../../runtime/hooks/lib/agent-delegation-core.mjs';
import { serializePluginHooksJson } from '@/plugin/manifest-build.js';

const REPO = resolve(import.meta.dirname, '../../..');
const HOOK = join(REPO, 'runtime/hooks/agent-delegation.mjs');
const LEDGER = '.paqad/ledger/authoring/delegations.jsonl';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(config = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-delegation-hook-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '/framework\n');
  writeFileSync(join(root, '.paqad/.config'), config);
  return root;
}

function runHook(
  root: string,
  payload: unknown,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [HOOK], {
    input:
      typeof payload === 'string' ? payload : JSON.stringify({ cwd: root, ...(payload as object) }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function ledger(root: string): Array<Record<string, unknown>> {
  if (!existsSync(join(root, LEDGER))) return [];
  return readFileSync(join(root, LEDGER), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const CALL = {
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  tool_input: {
    subagent_type: 'paqad:migration-reviewer',
    prompt: 'secret brief text',
    description: 'review',
  },
  tool_response: {
    status: 'completed',
    totalTokens: 1234,
    totalDurationMs: 5678,
    content: [{ type: 'text', text: 'I am code-reviewer, not migration-reviewer' }],
  },
  session_id: 'ses-1',
  tool_use_id: 'tu-1',
};

describe('the delegation core', () => {
  it('AC-11: takes the agent name from tool_input.subagent_type only, never the reply text', () => {
    expect(agentNameFromPayload(CALL)).toBe('migration-reviewer');
    expect(agentNameFromPayload({ tool_name: 'Task', tool_input: {} })).toBe('general-purpose');
    expect(agentNameFromPayload({ tool_name: 'Read', tool_input: {} })).toBeNull();
    expect(
      agentNameFromPayload({ tool_name: 'Agent', tool_input: { subagent_type: '../evil name' } }),
    ).toBeNull();
    expect(
      agentNameFromPayload({ hook_event_name: 'SubagentStop', agent_type: 'migration-reviewer' }),
    ).toBe('migration-reviewer');
    expect(agentNameFromPayload({ hook_event_name: 'SubagentStop' })).toBeNull();
  });

  it('AC-11: a row holds only the seven metadata fields', () => {
    const row = delegationFromPayload(CALL, new Date('2026-11-01T00:00:00.000Z'));
    expect(row).toEqual({
      agent: 'migration-reviewer',
      request_id: 'tu-1',
      session_id: 'ses-1',
      at: '2026-11-01T00:00:00.000Z',
      tokens: 1234,
      duration_ms: 5678,
      status: 'completed',
    });
    expect(
      delegationFromPayload({ hook_event_name: 'SubagentStop', agent_type: 'a', agent_id: 'x' })
        ?.status,
    ).toBe('stopped');
  });

  it('drops lines older than twice the dark window', () => {
    const now = new Date('2026-10-31T00:00:00.000Z');
    const keep = JSON.stringify({ agent: 'a', at: '2026-10-30T00:00:00.000Z' });
    const text = [keep, JSON.stringify({ agent: 'b', at: '2026-08-01T00:00:00.000Z' }), 'x'].join(
      '\n',
    );
    expect(pruneDelegationText(text, now, 30)).toBe(`${keep}\n`);
    expect(pruneDelegationText('', now, 30)).toBe('');
  });
});

describe('runtime/hooks/agent-delegation.mjs', () => {
  it('AC-11, INV-9: logs an Agent call and a SubagentStop, prints nothing and exits 0', () => {
    const root = project();
    const call = runHook(root, CALL);
    const stop = runHook(root, {
      hook_event_name: 'SubagentStop',
      agent_type: 'migration-reviewer',
      agent_id: 'ag-1',
      session_id: 'ses-1',
      last_assistant_message: 'secret reply',
    });
    expect([call, stop].map((result) => [result.status, result.stdout, result.stderr])).toEqual([
      [0, '', ''],
      [0, '', ''],
    ]);
    const rows = ledger(root);
    expect(rows.map((row) => [row.agent, row.status])).toEqual([
      ['migration-reviewer', 'completed'],
      ['migration-reviewer', 'stopped'],
    ]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'agent',
        'at',
        'duration_ms',
        'request_id',
        'session_id',
        'status',
        'tokens',
      ]);
    }
    const text = readFileSync(join(root, LEDGER), 'utf8');
    expect(text).not.toContain('secret');
  });

  it('INV-9: anything that is not an Agent or Task call or a SubagentStop records nothing', () => {
    const root = project();
    runHook(root, { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} });
    runHook(root, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {} });
    expect(existsSync(join(root, LEDGER))).toBe(false);
  });

  it('AC-65: malformed input and a non-Agent tool call exit 0 and write nothing', () => {
    const root = project();
    for (const payload of [
      '{not json',
      '',
      { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
    ]) {
      expect(runHook(root, payload)).toEqual({ status: 0, stdout: '', stderr: '' });
    }
    expect(existsSync(join(root, LEDGER))).toBe(false);
    expect(existsSync(join(root, '.paqad/ledger/authoring'))).toBe(false);
  });

  it('INV-9: a broken payload or an unwritable ledger never blocks', () => {
    const root = project();
    expect(runHook(root, '{not json')).toEqual({ status: 0, stdout: '', stderr: '' });
    mkdirSync(join(root, '.paqad/ledger'), { recursive: true });
    writeFileSync(join(root, '.paqad/ledger/authoring'), 'a file where a folder should be');
    expect(runHook(root, CALL)).toEqual({ status: 0, stdout: '', stderr: '' });
  });

  it('records nothing while paqad or the Agent Orchestrator is off, or the repo is not onboarded', () => {
    for (const config of ['paqad_enable=false\n', 'agent_orchestrator_enabled=false\n']) {
      const root = project(config);
      runHook(root, CALL);
      expect(ledger(root)).toEqual([]);
    }
    const root = project();
    rmSync(join(root, '.paqad/framework-path.txt'));
    runHook(root, CALL);
    expect(ledger(root)).toEqual([]);
  });

  it('prunes with authoring_dark_window_days once the ledger passes the size bound', () => {
    const root = project('authoring_dark_window_days=5\n');
    const line = JSON.stringify({
      agent: 'old-agent',
      at: new Date(Date.now() - 12 * 86_400_000).toISOString(),
    });
    mkdirSync(join(root, '.paqad/ledger/authoring'), { recursive: true });
    writeFileSync(join(root, LEDGER), `${line}\n`.repeat(Math.ceil(1_000_001 / (line.length + 1))));
    runHook(root, CALL);
    expect(ledger(root).map((entry) => entry.agent)).toEqual(['migration-reviewer']);
  });

  it('AC-11: the plugin hooks.json carries both delegation entries after the existing ones', () => {
    const hooks = JSON.parse(serializePluginHooksJson()).hooks as Record<
      string,
      Array<{ matcher?: string; hooks: Array<{ command: string }> }>
    >;
    expect(hooks.PostToolUse!.at(-1)!.matcher).toBe('Agent|Task');
    expect(hooks.SubagentStop!.at(-1)!.matcher).toBe('.*');
    expect(hooks.SubagentStop![0]!.matcher).toBe('^(paqad:)?paqad-');
    for (const group of [hooks.PostToolUse!.at(-1)!, hooks.SubagentStop!.at(-1)!]) {
      expect(group.hooks[0]!.command).toContain('agent-delegation.mjs');
    }
  });
});
