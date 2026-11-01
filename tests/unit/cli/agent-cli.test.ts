import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_OFF_LINE, createAgentCommand, runAgentVerb } from '@/cli/commands/agent.js';

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

describe('paqad-ai agent verb options', () => {
  const missing = (name: string): string => join(root, 'nowhere', name);
  const text = async (...args: string[]): Promise<{ all: string; code: number }> => {
    const result = await run(...args);
    return { all: `${result.out}\n${result.err}`, code: result.code };
  };

  it('justify reads --task-file and names a file it cannot read', async () => {
    const result = await text(
      'justify',
      'migration-reviewer',
      '--task-file',
      missing('task.md'),
      '--reason',
      'parallel',
    );
    expect(result.code).toBe(2);
    expect(result.all).toContain('could not read the task file');
    expect((await text('justify', 'migration-reviewer', '--refuse', 'one-off')).all).not.toContain(
      'could not read',
    );
  });

  it('intake: --gap needs --question and --recommend, a preset needs no file, and no file is refused', async () => {
    const gap = await text('intake', 'migration-reviewer', '--gap', 'owner');
    expect(gap.code).toBe(2);
    expect(gap.all).toContain('--gap needs --question, --option and --recommend.');
    const noRecommend = await text(
      'intake',
      'migration-reviewer',
      '--gap',
      'owner',
      '--question',
      'Who owns it?',
    );
    expect(noRecommend.all).toContain('--gap needs --question');
    const asked = await text(
      'intake',
      'migration-reviewer',
      '--gap',
      'owner',
      '--question',
      'Who owns it?',
      '--recommend',
      'Platform',
    );
    expect(asked.all).not.toContain('--gap needs');
    const preset = await text('intake', 'migration-reviewer', '--preset', 'explore');
    expect(preset.all).not.toContain('name the intake.yaml file.');
    const none = await text('intake', 'migration-reviewer');
    expect(none.code).toBe(2);
    expect(none.all).toContain('name the intake.yaml file.');
    const unreadable = await text('intake', 'migration-reviewer', missing('intake.yaml'));
    expect(unreadable.all).toContain('could not read the intake file');
  });

  it('evidence reads the sources file and an optional --lens file', async () => {
    const sources = write('sources.md', '| S-ID | source |\n');
    const lens = await text(
      'evidence',
      'migration-reviewer',
      sources,
      '--owns',
      'which migration is safe',
      '--lens',
      missing('lens.md'),
    );
    expect(lens.all).toContain('could not read the lens file');
    const plain = await text('evidence', 'migration-reviewer', sources);
    expect(plain.all).not.toContain('could not read');
  });

  it('draft needs --file and --trace unless it refuses, and reads --memory when given', async () => {
    const bare = await text('draft', 'migration-reviewer');
    expect(bare.code).toBe(2);
    expect(bare.all).toContain('draft needs --file <agent.md> and --trace <trace.md>.');
    const noTrace = await text('draft', 'migration-reviewer', '--file', 'agent.md');
    expect(noTrace.all).toContain('draft needs --file');
    const unreadTrace = await text(
      'draft',
      'migration-reviewer',
      '--file',
      'agent.md',
      '--trace',
      missing('trace.md'),
    );
    expect(unreadTrace.all).toContain('could not read the trace file');
    const trace = write('trace.md', '| block | S-ID |\n');
    const unreadMemory = await text(
      'draft',
      'migration-reviewer',
      '--file',
      'agent.md',
      '--trace',
      trace,
      '--memory',
      missing('MEMORY.md'),
    );
    expect(unreadMemory.all).toContain('could not read the memory file');
    const refused = await text('draft', 'migration-reviewer', '--refuse', 'not needed');
    expect(refused.all).not.toContain('draft needs --file');
  });

  it('delegation plan and record read their files only when named', async () => {
    expect(
      (await text('delegation', 'plan', 'migration-reviewer', missing('requests.json'))).all,
    ).toContain('could not read the requests file');
    expect((await text('delegation', 'plan', 'migration-reviewer')).all).not.toContain(
      'could not read',
    );
    expect(
      (await text('delegation', 'record', 'migration-reviewer', missing('results.json'))).all,
    ).toContain('could not read the results file');
    expect((await text('delegation', 'record', 'migration-reviewer')).all).not.toContain(
      'could not read',
    );
  });

  it('eval plan and record run their stage for the agent', async () => {
    const plan = await text('eval', 'plan', 'migration-reviewer', '--lever', 'brief');
    expect(plan.code).not.toBe(0);
    const record = await text('eval', 'record', 'migration-reviewer');
    expect(record.code).not.toBe(0);
  });

  it('override records from --decision and asks with --gate and --reason', async () => {
    const recorded = await text('override', 'migration-reviewer', 'S5', '--decision', 'D-nope');
    expect(recorded.code).not.toBe(0);
    const asked = await text(
      'override',
      'migration-reviewer',
      '--gate',
      'S5',
      '--reason',
      'the eval harness is down',
    );
    expect(asked.all).not.toContain('override needs');
  });

  it('learn applies a --decision or proposes a correction with empty defaults', async () => {
    const applied = await text('learn', 'migration-reviewer', '--decision', 'D-nope');
    expect(applied.code).not.toBe(0);
    const proposed = await text('learn', 'migration-reviewer');
    expect(proposed.code).not.toBe(0);
    const full = await text(
      'learn',
      'migration-reviewer',
      'Check the down migration too.',
      '--scope',
      'review',
      '--source',
      'S-1',
    );
    expect(full.code).not.toBe(0);
  });

  it('memory-consolidate reads --file only when named', async () => {
    expect(
      (await text('memory-consolidate', 'migration-reviewer', '--file', missing('MEMORY.md'))).all,
    ).toContain('could not read the MEMORY.md');
    expect((await text('memory-consolidate', 'migration-reviewer')).all).not.toContain(
      'could not read',
    );
  });

  it('drift, regression and test run for an agent with no release yet', async () => {
    for (const verb of ['drift', 'regression', 'test']) {
      const result = await text(verb, 'migration-reviewer');
      expect(result.all).not.toBe('\n');
    }
  });

  it('catalog lists the installed agents and honours the off switch', async () => {
    const listed = await text('catalog', '--propose-retirement');
    expect(listed.code).toBe(0);
    vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', 'false');
    expect((await run('catalog')).out).toBe(AGENT_OFF_LINE);
  });

  it('lint prints a broken project never-write list as a usage error', async () => {
    write('docs/instructions/rules/authoring/never-write.yaml', 'phrases: [unclosed\n');
    const file = write('.claude/agents/migration-reviewer.md', GOOD);
    const result = await run('lint', file);
    expect(result.code).toBe(2);
    expect(result.err).toContain('agent lint: docs/instructions/rules/authoring/never-write.yaml');
  });
});

describe('runAuthoringVerb', () => {
  it('lets an error that is not a refusal through to the caller', async () => {
    await expect(
      runAgentVerb('migration-reviewer', { projectRoot: root }, () => {
        throw new Error('disk on fire');
      }),
    ).rejects.toThrow('disk on fire');
  });
});
