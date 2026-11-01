import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentCommand } from '@/cli/commands/agent.js';
import { createSkillCommand } from '@/cli/commands/skill.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-lint-all-'));
  mkdirSync(join(root, 'home'), { recursive: true });
  vi.stubEnv('PAQAD_AGENT_ORCHESTRATOR_ENABLED', undefined);
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  write('.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

async function run(
  command: 'skill' | 'agent',
  ...args: string[]
): Promise<{ out: string; err: string; code: number }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    out.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    err.push(String(line));
  });
  process.exitCode = undefined;
  const cli = command === 'skill' ? createSkillCommand() : createAgentCommand();
  await cli.parseAsync([...args, '--project-root', root], { from: 'user' });
  const code = Number(process.exitCode ?? 0);
  vi.restoreAllMocks();
  return { out: out.join('\n'), err: err.join('\n'), code };
}

const CLEAN_SKILL =
  '---\nname: drafting-notes\ndescription: Drafts release notes. Use when the user asks for release notes.\n---\n# Notes\n\n1. Read the pull requests.\n';

describe('paqad-ai skill lint --all', () => {
  it('writes the report to --report and exits 0 with no blocking finding', async () => {
    write('.claude/skills/drafting-notes/SKILL.md', CLEAN_SKILL);
    const result = await run('skill', 'lint', '--all', '--report', 'out/skills.json');
    expect(result.code).toBe(0);
    expect(result.out).toContain('skill lint --all: 1 skill, 0 blocking findings');
    const report = JSON.parse(readFileSync(join(root, 'out/skills.json'), 'utf8'));
    expect(report.kind).toBe('skill');
    expect(report.items[0].path).toBe('.claude/skills/drafting-notes');
  });

  it('exits 1 on a blocking finding and groups by folder on request', async () => {
    write('.claude/skills/drafting-notes/SKILL.md', CLEAN_SKILL.replace('Read', 'Read — now'));
    const result = await run(
      'skill',
      'lint',
      '--all',
      '--group-by',
      'folder',
      '--report',
      'skills.json',
    );
    expect(result.code).toBe(1);
    const report = JSON.parse(readFileSync(join(root, 'skills.json'), 'utf8'));
    expect(report.groups[0].key).toBe('.claude/skills/drafting-notes');
  });

  it('exits 2 on a usage error', async () => {
    expect((await run('skill', 'lint')).code).toBe(2);
    expect((await run('skill', 'lint', '--all', '--group-by', 'team')).code).toBe(2);
    expect((await run('skill', 'lint', 'x', '--all')).code).toBe(2);
  });

  it('states the default report path in --help', () => {
    const help = createSkillCommand()
      .commands.find((command) => command.name() === 'lint')!
      .helpInformation();
    expect(help).toContain('.paqad/tmp/skill-lint-all.json');
  });
});

const BASH_AGENT = `---
name: migration-runner
description: 'Use this agent when a change adds a database migration, as in "run this migration".'
tools: Read, Grep, Glob, Bash
model: haiku
effort: low
maxTurns: 20
---

## Objective

Run the migration.

## Procedure

1. Read it.

## Report

At most 400 tokens. Status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED.

## Stop when

It has run.

## Do not

- Do not edit any file.

## Example

Input: <path>.
`;

describe('paqad-ai agent lint --all', () => {
  it('lists personas apart and never fails on them', async () => {
    write('package.json', '{"name":"paqad-ai"}\n');
    write('runtime/base/agents/router.md', '# Router\n\nYou route.\n');
    const result = await run('agent', 'lint', '--all', '--report', 'agents.json');
    expect(result.code).toBe(0);
    expect(result.out).toContain('1 persona listed apart');
    const report = JSON.parse(readFileSync(join(root, 'agents.json'), 'utf8'));
    expect(report.personas.map((persona: { name: string }) => persona.name)).toEqual(['router']);
  });

  it('exits 1 when an agent file blocks', async () => {
    write('.claude/agents/broken.md', '# Broken\n');
    const result = await run('agent', 'lint', '--all', '--report', 'agents.json');
    expect(result.code).toBe(1);
  });

  it('--owner-powers-as-warnings reports the owner-permission rules as warnings and blocks on the rest', async () => {
    write('.claude/agents/runner.md', BASH_AGENT);
    const strict = await run('agent', 'lint', '--all', '--report', 'agents.json');
    expect(strict.code).toBe(1);
    const strictReport = JSON.parse(readFileSync(join(root, 'agents.json'), 'utf8'));
    const strictPower = strictReport.items[0].findings.filter(
      (finding: { rule: string }) => finding.rule === 'AG-022',
    );
    expect(strictPower.map((finding: { severity: string }) => finding.severity)).toEqual(['block']);

    const relaxed = await run(
      'agent',
      'lint',
      '--all',
      '--owner-powers-as-warnings',
      '--report',
      'agents.json',
    );
    expect(relaxed.code).toBe(0);
    const report = JSON.parse(readFileSync(join(root, 'agents.json'), 'utf8'));
    const power = report.items[0].findings.filter(
      (finding: { rule: string }) => finding.rule === 'AG-022',
    );
    expect(power.map((finding: { severity: string }) => finding.severity)).toEqual(['warn']);
  });

  it('--owner-powers-as-warnings still blocks on every other agent rule', async () => {
    write('.claude/agents/broken.md', '# Broken\n');
    const result = await run(
      'agent',
      'lint',
      '--all',
      '--owner-powers-as-warnings',
      '--report',
      'agents.json',
    );
    expect(result.code).toBe(1);
  });

  it('a single-file agent lint refuses --owner-powers-as-warnings and keeps its rules', async () => {
    write('.claude/agents/runner.md', BASH_AGENT);
    expect((await run('agent', 'lint', join(root, '.claude/agents/runner.md'))).code).toBe(1);
    const flagged = await run(
      'agent',
      'lint',
      join(root, '.claude/agents/runner.md'),
      '--owner-powers-as-warnings',
    );
    expect(flagged.code).toBe(2);
  });

  it('exits 2 with neither a file nor --all', async () => {
    expect((await run('agent', 'lint')).code).toBe(2);
  });
});
