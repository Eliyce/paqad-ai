import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  STAGE_CONTENT_MAX_CHARS,
  STAGE_CONTENT_TRUNCATED_LINE,
  fitToCeiling,
  runStageBegin,
  type CommandRunner,
} from '@/stage-isolation/stage-begin.js';

const CLI = join(process.cwd(), 'dist/cli/index.js');
const SESSION = 'ses_begin';
const AGENT = 'agent_begin';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-stage-begin-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '/nowhere\n');
  return root;
}

async function cli(root: string, args: string[], agentId = AGENT) {
  return execa('node', [CLI, ...args], {
    cwd: root,
    env: { SE_SESSION: SESSION, SE_AGENT_ID: agentId },
    reject: false,
  });
}

function bundleDir(root: string): string {
  const base = join(root, '.paqad/ledger/feature-evidence');
  return join(base, readdirSync(base).filter((name) => name !== '_session')[0]!);
}

function startRows(root: string, stage: string): number {
  return readFileSync(join(bundleDir(root), 'stage-evidence.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; stage?: string })
    .filter((row) => row.kind === 'stage_start' && row.stage === stage).length;
}

async function openChange(root: string): Promise<void> {
  await cli(root, ['stage', 'start', 'planning', '--title', 'begin', '--issue', '1']);
}

function writeRulesRunner(root: string): CommandRunner {
  return (args) => {
    if (args[0] === 'rules') {
      writeFileSync(join(bundleDir(root), 'rules-loaded.json'), '{}\n');
    }
    return { ok: true, stdout: '', stderr: '' };
  };
}

describe('paqad-ai stage begin', () => {
  it('writes the start row and rules, and prints one JSON object', async () => {
    const root = tempRoot();
    await openChange(root);
    writeFileSync(join(bundleDir(root), 'plan.json'), '{"plan":"text"}\n');
    const result = runStageBegin({
      projectRoot: root,
      sessionId: SESSION,
      stage: 'development',
      run: writeRulesRunner(root),
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatchObject({
      stage: 'development',
      started: true,
      rules_loaded: true,
    });
    expect(result.output.pillars.some((path) => path.endsWith('plan.json'))).toBe(true);
    expect(result.output.content.pillars.plan).toContain('"plan":"text"');
  });

  it('runs through the CLI: one JSON object and a start row, with the agent named', async () => {
    const root = tempRoot();
    await openChange(root);
    await cli(root, ['stage', 'end', 'planning']);
    const run = await cli(root, [
      'stage',
      'begin',
      'specification',
      '--agent',
      'paqad-specification',
    ]);
    expect(run.exitCode).toBe(0);
    const output = JSON.parse(run.stdout) as { stage: string; started: boolean };
    expect(output).toMatchObject({ stage: 'specification', started: true });
    expect(startRows(root, 'specification')).toBe(1);
  });

  it('AC-28: holds the review digest and frozen spec text, not only their paths', async () => {
    const root = tempRoot();
    await openChange(root);
    writeFileSync(join(bundleDir(root), 'specification.json'), '{"frozen":"spec text"}\n');
    const digest = join(root, 'digest.md');
    writeFileSync(digest, 'the digest text\n');
    const result = runStageBegin({
      projectRoot: root,
      sessionId: SESSION,
      stage: 'review',
      run: (args) =>
        args[0] === 'review'
          ? { ok: true, stdout: JSON.stringify({ written: true, path: 'digest.md' }), stderr: '' }
          : { ok: true, stdout: '', stderr: '' },
    });
    expect(result.output.content.pillars.specification).toContain('spec text');
    expect(result.output.content.review_digest).toContain('the digest text');
  });

  it('AC-29: truncates an oversized pillar at 27,000 characters and keeps every instruction and command line', async () => {
    const root = tempRoot();
    await openChange(root);
    writeFileSync(join(bundleDir(root), 'plan.json'), 'p'.repeat(100_000));
    const result = runStageBegin({
      projectRoot: root,
      sessionId: SESSION,
      stage: 'specification',
      run: () => ({ ok: true, stdout: '', stderr: '' }),
    });
    expect(STAGE_CONTENT_MAX_CHARS).toBe(27_000);
    expect(STAGE_CONTENT_TRUNCATED_LINE).toBe(
      'truncated at 27,000 characters; read the file for the rest',
    );
    expect(result.output.content.pillars.plan).toContain(STAGE_CONTENT_TRUNCATED_LINE);
    expect(result.output.truncated).toEqual(['plan']);
    expect(result.output.instructions.length).toBeGreaterThan(0);
    expect(result.output.commands.join('\n')).toContain('stage end specification');
    expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(STAGE_CONTENT_MAX_CHARS);
  });

  it('keeps the worst case under the ceiling, with text that escapes in JSON', async () => {
    const root = tempRoot();
    await openChange(root);
    writeFileSync(join(bundleDir(root), 'plan.json'), '"\n'.repeat(60_000));
    writeFileSync(join(bundleDir(root), 'specification.json'), '\\'.repeat(120_000));
    writeFileSync(join(bundleDir(root), 'request.md'), '"'.repeat(120_000));
    const result = runStageBegin({
      projectRoot: root,
      sessionId: SESSION,
      stage: 'development',
      run: writeRulesRunner(root),
    });
    expect(JSON.stringify(result.output).length).toBeLessThanOrEqual(STAGE_CONTENT_MAX_CHARS);
  });

  it('AC-30: names the failed step, and a re-run neither repeats the start nor claims the rules', async () => {
    const root = tempRoot();
    await openChange(root);
    const failing: CommandRunner = (args) =>
      args[0] === 'rules'
        ? { ok: false, stdout: '', stderr: 'rules are broken' }
        : { ok: true, stdout: '', stderr: '' };
    await cli(root, ['stage', 'start', 'development']);
    const first = runStageBegin({
      projectRoot: root,
      sessionId: SESSION,
      stage: 'development',
      run: failing,
    });
    expect(first.exitCode).toBe(1);
    expect(first.output).toMatchObject({ failed_step: 'rules load', rules_loaded: false });
    const again = runStageBegin({
      projectRoot: root,
      sessionId: SESSION,
      stage: 'development',
      run: failing,
    });
    expect(again.output.rules_loaded).toBe(false);
    expect(startRows(root, 'development')).toBe(1);
  });

  it('does not start twice, for a resumed agent or a fresh one', async () => {
    const root = tempRoot();
    await openChange(root);
    await cli(root, ['stage', 'end', 'planning']);
    const first = await cli(root, ['stage', 'begin', 'specification']);
    const second = await cli(root, ['stage', 'begin', 'specification'], 'agent_fresh');
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({
      stage: 'specification',
      started: false,
    });
    expect(startRows(root, 'specification')).toBe(1);
  });

  it('refuses past a blocked earlier stage, exactly as stage start does', async () => {
    const root = tempRoot();
    await cli(root, ['stage', 'start', 'review', '--title', 'begin', '--issue', '1']);
    await execa('node', [join(process.cwd(), 'runtime/hooks/stage-agent-completion.mjs')], {
      input: JSON.stringify({
        session_id: SESSION,
        agent_id: AGENT,
        agent_type: 'paqad-review',
        hook_event_name: 'SubagentStop',
        last_assistant_message: 'stuck\nStatus: BLOCKED',
      }),
      env: { PAQAD_PROJECT_ROOT: root },
      reject: false,
    });
    const refused = await cli(root, ['stage', 'begin', 'checks']);
    expect(refused.exitCode).toBe(1);
    const output = JSON.parse(refused.stdout) as { failed_step: string; error: string };
    expect(output.failed_step).toBe('stage start');
    expect(output.error).toContain('review');
  });

  it('rejects a stage with no stage agent, printing JSON', async () => {
    const root = tempRoot();
    const run = await cli(root, ['stage', 'begin', 'nonsense']);
    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ stage: 'nonsense', failed_step: 'stage start' });
  });
});

describe('fitting content under the ceiling', () => {
  const slot = (name: string, size: number) => ({
    name,
    full: 'x'.repeat(size),
    kept: size,
  });

  const total = (content: { request: string; pillars: Record<string, string> }) =>
    content.request.length +
    Object.values(content.pillars).reduce((sum, text) => sum + text.length, 0);

  it('AC-30: cuts the longest first, with pillars around 27,000 and 27,001 characters', () => {
    const slots = [slot('plan', 27_001), slot('specification', 27_000), slot('request', 100)];
    const fitted = fitToCeiling(slots, total, 54_000);
    expect(total(fitted)).toBeLessThanOrEqual(54_000);
    expect(fitted.request).toHaveLength(100);
    expect(fitted.pillars.plan).toContain(STAGE_CONTENT_TRUNCATED_LINE);
    expect(fitted.pillars.specification).toHaveLength(27_000);
  });

  it('AC-29: cuts nothing at 27,000 characters, and cuts at 27,001', () => {
    const size = (content: { request: string }) => content.request.length;
    const exact = fitToCeiling([slot('request', 27_000)], size, STAGE_CONTENT_MAX_CHARS);
    expect(exact.request).toHaveLength(27_000);
    expect(exact.request).not.toContain(STAGE_CONTENT_TRUNCATED_LINE);
    const over = fitToCeiling([slot('request', 27_001)], size, STAGE_CONTENT_MAX_CHARS);
    expect(over.request).toContain(STAGE_CONTENT_TRUNCATED_LINE);
    expect(size(over)).toBeLessThanOrEqual(27_000);
  });
});
