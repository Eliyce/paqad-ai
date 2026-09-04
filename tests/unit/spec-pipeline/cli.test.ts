import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { pipelineArtifactPath } from '@/spec-pipeline/orchestrator.js';

/** Seed one resolved intake.requirement decision so the S2 auto-answer seam can hit it. */
function seedResolvedDecision(root: string): void {
  const dir = join(root, PATHS.DECISIONS_RESOLVED_DIR);
  mkdirSync(dir, { recursive: true });
  const now = '2026-09-04T00:00:00.000Z';
  writeFileSync(
    join(dir, 'D-900.json'),
    JSON.stringify({
      decision_id: 'D-900',
      fingerprint: 'sha256:D-900',
      category: 'intake.requirement',
      question: 'Should exports include archived orders?',
      context:
        'It changes which rows appear in the file. Include archived orders Exclude archived orders',
      options: [
        {
          option_key: 'include-archived-orders',
          label: 'Include archived orders',
          one_line_preview: 'include',
          trade_off: 'bigger',
          evidence: {},
        },
        {
          option_key: 'exclude-archived-orders',
          label: 'Exclude archived orders',
          one_line_preview: 'omit',
          trade_off: 'fewer',
          evidence: {},
        },
      ],
      confidence: 0.9,
      requested_by: 'agent',
      task_session_id: 'task-cli',
      created_at: now,
      status: 'resolved',
      ttl_until: '2026-12-31T00:00:00.000Z',
      invalidation_watch: [],
      human_response: {
        chosen_option_key: 'include-archived-orders',
        intent: 'explicit',
        explanation_rounds_used: 0,
        responded_at: now,
        responded_by: 'human',
        carry_over_scope: 'task',
      },
    }),
    'utf8',
  );
}

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
    writeFileSync(
      join(root, 'task.json'),
      JSON.stringify({ intent: 'exclude hidden columns' }),
      'utf8',
    );
    await run(root, ['record', 'task', join(root, 'task.json')]);
    writeFileSync(
      join(root, 'spec.md'),
      [
        '## Functional requirements',
        'FR-1: excludes hidden columns.',
        '## Acceptance criteria',
        '- AC-1: Given an admin, when they export, then hidden columns are omitted (proof: automated).',
      ].join('\n'),
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
    expect(JSON.parse(out[0]!)).toMatchObject({
      step: 'finish',
      outcome: 'non-blocking-review',
      a5_live: false,
    });
  });

  it('record questions auto-answers a ledger-answerable question and drops it from the batch (AC-1/AC-3)', async () => {
    const root = tempRoot();
    seedResolvedDecision(root);
    const dir = activeFeature(root);
    await run(root, ['ground']);
    await run(root, ['label', 'the export must exclude hidden columns and return in 5s']);

    writeFileSync(
      join(root, 'questions.json'),
      JSON.stringify({
        questions: [
          {
            business_text: 'Should exports include archived orders?',
            why_it_matters: 'It changes which rows appear in the file.',
            options: ['Include archived orders', 'Exclude archived orders'],
            grounded_in: null,
          },
          {
            business_text: 'How long should the onboarding banner stay visible?',
            why_it_matters: 'It affects first-run UX.',
            options: ['Until dismissed', 'For 10 seconds'],
            grounded_in: null,
          },
        ],
      }),
      'utf8',
    );
    const { out } = await run(root, ['record', 'questions', join(root, 'questions.json')]);
    expect(JSON.parse(out[0]!)).toMatchObject({ step: 'questions', asked: 1, auto_answered: 1 });

    const persisted = JSON.parse(
      readFileSync(join(root, pipelineArtifactPath(dir, 'questions')), 'utf8'),
    );
    // The ledger-answerable question never survives into the batch handed to the user.
    expect(persisted.questions).toHaveLength(1);
    expect(persisted.questions[0].business_text).toBe(
      'How long should the onboarding banner stay visible?',
    );
    expect(persisted.auto_answered).toEqual([
      {
        question: 'Should exports include archived orders?',
        answer: 'Include archived orders',
        source: 'D-900',
      },
    ]);
    expect(persisted.asked).toBe(1);
  });

  it('finish provenance lists the auto-answered refs and counts (AC-4/AC-5)', async () => {
    const root = tempRoot();
    seedResolvedDecision(root);
    const dir = activeFeature(root);
    await run(root, ['ground']);
    await run(root, ['label', 'the export must exclude hidden columns and return in 5s']);
    writeFileSync(
      join(root, 'questions.json'),
      JSON.stringify({
        questions: [
          {
            business_text: 'Should exports include archived orders?',
            why_it_matters: 'It changes which rows appear in the file.',
            options: ['Include archived orders', 'Exclude archived orders'],
            grounded_in: null,
          },
        ],
      }),
      'utf8',
    );
    await run(root, ['record', 'questions', join(root, 'questions.json')]);
    writeFileSync(join(root, 'task.json'), JSON.stringify({ intent: 'export rows' }), 'utf8');
    await run(root, ['record', 'task', join(root, 'task.json')]);
    writeFileSync(
      join(root, 'spec.md'),
      [
        '## Functional requirements',
        'FR-1: excludes hidden columns.',
        '## Acceptance criteria',
        '- AC-1: Given an admin, when they export, then hidden columns are omitted (proof: automated).',
      ].join('\n'),
      'utf8',
    );
    await run(root, ['record', 'craft', join(root, 'spec.md')]);
    await run(root, ['finish']);

    const finish = JSON.parse(
      readFileSync(join(root, pipelineArtifactPath(dir, 'finish')), 'utf8'),
    );
    expect(finish.provenance.answer_refs).toEqual(['D-900']);
    expect(finish.provenance.questions).toMatchObject({ asked: 0, auto_answered: 1 });
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
