import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_OFF_LINE, createAgentCommand } from '@/cli/commands/agent.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-agent-cli-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'), { recursive: true });
  vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', undefined);
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

async function run(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    out.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    err.push(String(line));
  });
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  process.exitCode = undefined;
  await createAgentCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
  const code = Number(process.exitCode ?? 0);
  stdout.mockRestore();
  vi.restoreAllMocks();
  return { out: out.join('\n'), err: err.join('\n'), code };
}

const GOOD = `---
name: migration-reviewer
description: 'Use this agent when a change adds a database migration, as in "review this migration".'
tools: Read, Grep, Glob
model: haiku
effort: low
maxTurns: 20
---

## Objective

Judge the migration.

## Procedure

1. Read it.

## Report

At most 400 tokens. Status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED.

## Stop when

It is judged.

## Do not

- Do not edit any file.

## Example

Input: <path>.
`;

describe('paqad-ai agent lint', () => {
  it('exits 0 for a clean agent and prints the summary', async () => {
    const file = write('.claude/agents/migration-reviewer.md', GOOD);
    const result = await run('lint', file);
    expect(result.code).toBe(0);
    expect(result.out).toContain('migration-reviewer: no blocking findings (0 warnings).');
  });

  it('AC-2: exits 1 with AG-007 when maxTurns is missing, in text and JSON', async () => {
    const file = write('.claude/agents/migration-reviewer.md', GOOD.replace('maxTurns: 20\n', ''));
    const text = await run('lint', file);
    expect(text.code).toBe(1);
    expect(text.out).toContain('AG-007 block .claude/agents/migration-reviewer.md:');
    expect(text.out).toContain('1 blocking finding, 0 warnings.');
    const json = await run('lint', file, '--json');
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out).findings[0].rule).toBe('AG-007');
  });

  it('exits 2 on a Codex TOML or a missing file', async () => {
    const toml = write('.codex/agents/migration-reviewer.toml', 'name = "x"\n');
    const result = await run('lint', toml);
    expect(result.code).toBe(2);
    expect(result.err).toContain('agent lint: ');
    expect((await run('lint', join(root, 'nope.md'))).code).toBe(2);
  });

  it('reads the agent limits from the config', async () => {
    write('.paqad/.config', 'agent_description_max_tokens=5\n');
    const file = write('.claude/agents/migration-reviewer.md', GOOD);
    const result = await run('lint', file);
    expect(result.code).toBe(1);
    expect(result.out).toContain('over the limit of 5 (agent_description_max_tokens)');
  });

  it('does nothing when the Agent Orchestrator is off', async () => {
    vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', 'false');
    const file = write('.claude/agents/migration-reviewer.md', '# bad');
    const result = await run('lint', file);
    expect(result.code).toBe(0);
    expect(result.out).toBe(AGENT_OFF_LINE);
  });
});

describe('paqad-ai agent status', () => {
  it('AC-53: names the next verb for a fresh agent and refuses a bad name', async () => {
    const result = await run('status', 'migration-reviewer');
    expect(result.code).toBe(0);
    expect(result.out).toContain('Entry: paqad-ai agent justify migration-reviewer (a new agent).');
    expect(result.out).toContain(
      'Next: S0 justify, run paqad-ai agent justify migration-reviewer --task-file <task.md> --reason <key>.',
    );
    const bad = await run('status', '../escape');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('is not an agent name');
  });

  it('prints JSON and honours the off switch', async () => {
    const json = await run('status', 'migration-reviewer', '--json');
    expect(JSON.parse(json.out).ok).toBe(true);
    vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', 'false');
    expect((await run('status', 'migration-reviewer')).out).toBe(AGENT_OFF_LINE);
  });

  it('AC-9: release refuses an agent whose gates have not passed', async () => {
    const result = await run('release', 'migration-reviewer');
    expect(result.code).not.toBe(0);
    expect(`${result.out}${result.err}`).toContain("S7 release can't start");
  });

  it('override needs a stage and either --reason or --decision', async () => {
    expect((await run('override', 'migration-reviewer')).code).toBe(2);
    const missing = await run('override', 'migration-reviewer', 'S5');
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('--reason <text>');
  });

  it('improve refuses an agent that is not installed', async () => {
    const result = await run('improve', 'migration-reviewer');
    expect(result.code).not.toBe(0);
    expect(`${result.out}${result.err}`).toContain('no installed agent named migration-reviewer');
  });
});
