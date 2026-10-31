import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSkillCommand } from '@/cli/commands/skill.js';
import { resolvePendingDecision } from '@/decisions/authoring.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const NAME = 'processing-invoices';
const WS = `.paqad/tmp/authoring/skills/${NAME}`;
const SES = 'ses-skill-cli';
const SKILL = [
  '---',
  `name: ${NAME}`,
  'description: Parses supplier invoices. Use when an invoice arrives.',
  '---',
  '',
  '# Processing invoices',
  '',
  '1. Read the invoice.',
  '',
].join('\n');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-cli-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'), { recursive: true });
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  vi.stubEnv('SE_SESSION', undefined);
  vi.stubEnv('CLAUDE_SESSION_ID', undefined);
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
  vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: string) => void err.push(String(line)));
  process.exitCode = undefined;
  await createSkillCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
  const code = Number(process.exitCode ?? 0);
  vi.restoreAllMocks();
  return { out: out.join('\n'), err: err.join('\n'), code };
}

function turnOff(): void {
  write('.paqad/.config', 'skill_orchestrator_enabled=false\n');
}

describe('paqad-ai skill lint output', () => {
  it('prints the blocking count and exits 1 on a blocking finding', async () => {
    write('.claude/skills/bad-skill/SKILL.md', '---\nname: bad-skill\n---\n\n# Bad\n');
    const result = await run('lint', join(root, '.claude/skills/bad-skill'));
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/bad-skill: \d+ blocking findings?, \d+ warnings?\./u);
  });

  it('exits 2 on a folder with no SKILL.md', async () => {
    mkdirSync(join(root, 'empty'), { recursive: true });
    const result = await run('lint', join(root, 'empty'));
    expect(result.code).toBe(2);
    expect(result.err).toContain('skill lint:');
  });

  it('lints a workspace draft and ignores paths that only look like one', async () => {
    write(`${WS}/draft/${NAME}/SKILL.md`, SKILL);
    write(`${WS}/draft/other-name/SKILL.md`, SKILL.replace(`name: ${NAME}`, 'name: other-name'));
    write(`${WS}/draft/${NAME}/nested/SKILL.md`, SKILL);
    expect((await run('lint', join(root, `${WS}/draft/${NAME}`))).out).toContain(NAME);
    expect((await run('lint', join(root, `${WS}/draft/other-name`))).out).toContain('other-name');
  });
});

describe('verb options and refusals', () => {
  it('prints a verb result as JSON with --json', async () => {
    const result = await run('status', NAME, '--json');
    const parsed = JSON.parse(result.out) as { ok: boolean; lines: string[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.lines.join('\n')).toContain('S0 justify');
  });

  it('refuses intake --gap without its question and recommendation', async () => {
    const result = await run('intake', NAME, '--gap', 'purpose');
    expect(result.code).toBe(2);
    expect(result.err).toContain('--gap needs --question, --option and --recommend.');
  });

  it('refuses intake with neither a file nor a gap', async () => {
    const result = await run('intake', NAME);
    expect(result.code).toBe(2);
    expect(result.err).toContain('name the intake.yaml file.');
  });

  it('refuses an unreadable input file with a usage exit', async () => {
    const result = await run('trigger', 'plan', NAME, join(root, 'missing.json'));
    expect(result.code).toBe(2);
    expect(result.err).toContain('could not read the queries file');
  });

  it('refuses draft without --dir and --trace', async () => {
    const result = await run('draft', NAME);
    expect(result.code).toBe(2);
    expect(result.err).toContain('draft needs --dir <folder> and --trace <trace.md>.');
  });

  it('refuses override without --decision or --ask', async () => {
    const result = await run('override', NAME, '--gate', 'S5');
    expect(result.code).toBe(2);
    expect(result.err).toContain('override needs --decision <id>, or --ask <why>');
  });

  it('asks for an override, then records it once the owner answers', async () => {
    const ask = await run('override', NAME, '--gate', 'S5', '--ask', 'no subagents here');
    const decision = /decision (D-[A-Z0-9]+)/u.exec(ask.out)![1]!;
    resolvePendingDecision(root, decision, 'add-unverified', 'ship it');
    const recorded = await run('override', NAME, '--gate', 'S5', '--decision', decision);
    expect(recorded.code).toBe(0);
    expect(recorded.out).toContain(`Recorded the S5 override from ${decision}`);
  });

  it('refuses learn for a skill that is not installed, and an unknown learn decision', async () => {
    const learn = await run('learn', NAME);
    expect(learn.err).toContain(`There is no installed skill named ${NAME} to learn from.`);
    const resolved = await run('learn', NAME, '--decision', 'D-01M6000000000000000000000X');
    expect(resolved.err).toContain('There is no pending correction');
  });

  it('records the active change on a decision when a session has one open', async () => {
    const sessionId = resolveSessionId(root, SES);
    write('.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
    openFeatureChange(root, sessionId, {
      adapter: 'claude-code',
      title: 'add skill',
      lane: 'full',
    });
    const ask = await run('override', NAME, '--gate', 'S5', '--ask', 'why', '--session', SES);
    expect(ask.out).toContain('Asked decision');
  });
});

describe('the catalog verb', () => {
  it('prints the catalog, and JSON with --json', async () => {
    expect((await run('catalog')).code).toBe(0);
    const json = await run('catalog', '--json');
    expect(JSON.parse(json.out)).toMatchObject({ ok: true });
  });

  it('does nothing while the orchestrator is off', async () => {
    turnOff();
    expect((await run('catalog')).out).toContain('The Skill Orchestrator is off');
  });
});

describe('the evidence verbs read their files', () => {
  it('passes the sources kind and decision through to S2', async () => {
    const result = await run(
      'evidence',
      NAME,
      write('sources.md', '| S-ID | Fact | Origin | Date | Verified |\n'),
      '--sources-kind',
      'no-repo',
    );
    expect(result.code).not.toBe(0);
    expect(readFileSync(join(root, 'sources.md'), 'utf8')).toContain('S-ID');
  });
});
