import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { pipelineArtifactPath } from '@/spec-pipeline/orchestrator.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-sp-cli-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = 0;
});

const SES = 'ses_cli';
function activeFeature(root: string): string {
  return openFeatureChange(root, SES, {
    adapter: 'claude-code',
    title: 'pipeline cli',
    issue: '512',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
}

async function run(root: string, args: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void out.push(String(m)));
  vi.spyOn(console, 'error').mockImplementation((m?: unknown) => void err.push(String(m)));
  await createSpecPipelineCommand().parseAsync(
    [...args, '--project-root', root, '--session', SES],
    { from: 'user' },
  );
  return { out, err };
}

describe('spec pipeline CLI', () => {
  beforeEach(() => {
    process.exitCode = 0;
  });

  it('errors with exit 1 when no feature is active', async () => {
    const root = tempRoot();
    const { err } = await run(root, ['status']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/no active feature/);
  });

  it('status reports the next step and enforcement config', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { out } = await run(root, ['status']);
    expect(JSON.parse(out[0]!)).toMatchObject({ enabled: false, next_step: 'ground' });
  });

  it('ground writes grounding.json and advances', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    await run(root, ['ground']);
    expect(existsSync(join(root, pipelineArtifactPath(dir, 'ground')))).toBe(true);
    const { out } = await run(root, ['status']);
    expect(JSON.parse(out[0]!).next_step).toBe('label');
  });

  it('label refuses before ground (step lock)', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { err } = await run(root, ['label', 'make the export cleaner']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/earlier step "ground"/);
  });

  it('ground then label produces a label', async () => {
    const root = tempRoot();
    activeFeature(root);
    await run(root, ['ground']);
    const { out } = await run(root, ['label', 'the export must exclude hidden columns']);
    expect(JSON.parse(out[0]!).step).toBe('label');
  });

  it('record rejects an unknown step', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { err } = await run(root, ['record', 'bogus', '/x']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/questions, task, craft/);
  });

  /** Drive ground → label → questions → task → craft on a bare root, returning the dir. */
  async function driveToCraft(root: string): Promise<void> {
    activeFeature(root);
    await run(root, ['ground']);
    await run(root, ['label', 'the export must exclude hidden columns and return in 5s']);
    writeFileSync(join(root, 'questions.json'), JSON.stringify({ questions: [] }), 'utf8');
    await run(root, ['record', 'questions', join(root, 'questions.json')]);
    writeFileSync(join(root, 'task.json'), JSON.stringify({ intent: 'exclude hidden columns' }), 'utf8');
    await run(root, ['record', 'task', join(root, 'task.json')]);
    writeFileSync(
      join(root, 'spec.md'),
      ['## Functional requirements', 'FR-1: excludes hidden columns.', '## Acceptance criteria', '- AC-1: Given an admin, when they export, then hidden columns are omitted (proof: automated).'].join('\n'),
      'utf8',
    );
  }

  it('record validates an agent craft artifact and advances', async () => {
    const root = tempRoot();
    await driveToCraft(root);
    const { out } = await run(root, ['record', 'craft', join(root, 'spec.md')]);
    expect(JSON.parse(out[0]!)).toMatchObject({ step: 'craft', recorded: true });
  });

  async function groundAndLabel(root: string): Promise<void> {
    activeFeature(root);
    await run(root, ['ground']);
    await run(root, ['label', 'the export must exclude hidden columns and return in 5s']);
  }

  it('record errors when the artifact file cannot be read', async () => {
    const root = tempRoot();
    await groundAndLabel(root);
    const { err } = await run(root, ['record', 'questions', join(root, 'nope.json')]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/could not read/);
  });

  it('record rejects an artifact whose shape is invalid', async () => {
    const root = tempRoot();
    await groundAndLabel(root);
    const bad = join(root, 'bad.json');
    writeFileSync(bad, 'not json at all', 'utf8');
    const { err } = await run(root, ['record', 'questions', bad]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/invalid/);
  });

  it('finish decides a non-blocking review when A5 is not live', async () => {
    const root = tempRoot();
    await driveToCraft(root);
    await run(root, ['record', 'craft', join(root, 'spec.md')]);
    const { out } = await run(root, ['finish']);
    expect(JSON.parse(out[0]!)).toMatchObject({ step: 'finish', outcome: 'non-blocking-review', a5_live: false });
  });

  it('redo archives a step and reports what was invalidated', async () => {
    const root = tempRoot();
    activeFeature(root);
    await run(root, ['ground']);
    const { out } = await run(root, ['redo', 'ground']);
    expect(JSON.parse(out[0]!)).toMatchObject({ redo: 'ground', invalidated: ['ground'] });
  });

  it('redo rejects an unknown step', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { err } = await run(root, ['redo', 'nope']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/unknown step/);
  });
});
