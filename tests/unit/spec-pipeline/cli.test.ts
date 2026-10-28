import {
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import {
  readClarification,
  readSpecStepRows,
  stagedFilePath,
  writeExpertRoster,
  writeStagedJson,
} from '@/spec-pipeline/run-store.js';
import { requestDigest } from '@/spec-pipeline/grounding.js';
import { pinSpecPipelineOff } from '../../shared/spec-pipeline-off.js';

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
  pinSpecPipelineOff(r);
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
    expect(existsSync(join(root, stagedFilePath(dir, 'grounding')))).toBe(true);
    expect(readSpecStepRows(root, dir).map((row) => [row.step, row.session_id])).toEqual([
      ['ground', SES],
    ]);
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
    const dir = activeFeature(root);
    await run(root, ['ground']);
    const { out } = await run(root, ['label', 'the export must exclude hidden columns']);
    expect(JSON.parse(out[0]!).step).toBe('label');
    expect(readClarification(root, dir)?.label?.value).toBeDefined();
    const request = readFileSync(join(root, featureFilePath(dir, 'request')), 'utf8');
    expect(splitFrontMatter(request).body).toBe('the export must exclude hidden columns');
  });

  it('record rejects an unknown step', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { err } = await run(root, ['record', 'bogus', '/x']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/questions, task, craft/);
  });

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

    const persisted = readClarification(root, dir)!.questions!;
    expect(persisted.asked).toHaveLength(1);
    expect(persisted.asked[0]!.business_text).toBe(
      'How long should the onboarding banner stay visible?',
    );
    expect(persisted.auto_answered).toEqual([
      {
        question: 'Should exports include archived orders?',
        answer: 'Include archived orders',
        source: 'D-900',
      },
    ]);
    expect(persisted.counts).toEqual({ asked: 1, answered: 0, auto_answered: 1, deferred: 0 });
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

    const finish = JSON.parse(readFileSync(join(root, stagedFilePath(dir, 'finish')), 'utf8'));
    expect(finish.provenance.answer_refs).toEqual(['D-900']);
    expect(finish.provenance.questions).toMatchObject({ asked: 0, auto_answered: 1 });
  });

  it('redo clears a step, records a redone row, and reports what was invalidated', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    await run(root, ['ground']);
    const { out } = await run(root, ['redo', 'ground']);
    expect(JSON.parse(out[0]!)).toMatchObject({ redo: 'ground', invalidated: ['ground'] });
    expect(readSpecStepRows(root, dir).map((row) => [row.outcome, row.session_id])).toEqual([
      ['complete', SES],
      ['redone', SES],
    ]);
  });

  it('redo rejects an unknown step', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { err } = await run(root, ['redo', 'nope']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/unknown step/);
  });
});

describe('spec pipeline CLI — craft trace + question merge', () => {
  function enablePipeline(root: string, experts = false): void {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    const lines = ['spec_pipeline_enabled=true'];
    if (experts) lines.push('spec_pipeline_experts_enabled=true');
    writeFileSync(join(root, '.paqad', '.config'), lines.join('\n'), 'utf8');
  }
  function writeJson(root: string, name: string, value: unknown): string {
    const path = join(root, name);
    writeFileSync(path, JSON.stringify(value), 'utf8');
    return path;
  }
  const SPEC = [
    '# Spec',
    '## Functional requirements',
    '- FR-1: index invoices.customer_id',
    '## Acceptance criteria',
    '- AC-1: given a lookup, when it runs, then it uses the index (proof: automated)',
    '## Invariants',
    '- INV-1: the index exists',
  ].join('\n');

  async function driveToCraft(root: string): Promise<void> {
    await run(root, ['ground']);
    await run(root, ['label', 'add a customer_id index to the invoices table']);
    await run(root, ['record', 'questions', writeJson(root, 'q.json', { questions: [] })]);
    await run(root, ['record', 'task', writeJson(root, 'task.json', { intent: 'index invoices' })]);
  }

  it('refuses craft without --trace while the pipeline is on (FR-8.3)', async () => {
    const root = tempRoot();
    activeFeature(root);
    enablePipeline(root);
    await driveToCraft(root);
    const spec = join(root, 'spec.md');
    writeFileSync(spec, SPEC, 'utf8');
    const { err } = await run(root, ['record', 'craft', spec]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/needs --trace/);
  });

  it('refuses an untraced requirement line and accepts a fully traced spec, writing trace.json', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    enablePipeline(root);
    await driveToCraft(root);
    const spec = join(root, 'spec.md');
    writeFileSync(spec, SPEC, 'utf8');

    const partial = writeJson(root, 'trace-partial.json', {
      entries: [
        { id: 'FR-1', source: 'task.intent' },
        { id: 'AC-1', source: 'task.intent' },
      ],
    });
    const bad = await run(root, ['record', 'craft', spec, '--trace', partial]);
    expect(process.exitCode).toBe(1);
    expect(bad.err.join('\n')).toMatch(/line "INV-1" has no source/);

    process.exitCode = 0;
    const full = writeJson(root, 'trace.json', {
      entries: [
        { id: 'FR-1', source: 'task.intent' },
        { id: 'AC-1', source: 'task.intent' },
        { id: 'INV-1', source: 'task.intent' },
      ],
    });
    const good = await run(root, ['record', 'craft', spec, '--trace', full]);
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(good.out[0]!)).toMatchObject({ recorded: true, traced: true });
    expect(existsSync(join(root, stagedFilePath(dir, 'trace')))).toBe(true);
  });

  it('merges expert and chief questions into the S2 batch (FR-7)', async () => {
    const root = tempRoot();
    activeFeature(root);
    enablePipeline(root, true);
    await run(root, ['ground']);
    await run(root, ['label', 'add a customer_id index to the invoices table']);
    await run(root, [
      'experts',
      'record',
      writeJson(root, 'need.json', { experts: [{ role: 'db-expert', reason: 'index' }] }),
    ]);
    await run(root, [
      'experts',
      'notes',
      writeJson(root, 'notes.json', {
        notes: [
          {
            role: 'db-expert',
            findings: [{ target: 'invoices', claim: 'index it' }],
            questions: [
              {
                business_text: 'How many invoices should one customer download at once?',
                why_it_matters: 'a bulk export needs a plan',
                options: ['a few', 'thousands'],
                grounded_in: null,
              },
            ],
          },
        ],
        tokens: {},
      }),
    ]);
    await run(root, [
      'experts',
      'synthesis',
      writeJson(root, 'synth.json', {
        verdict: 'ready',
        accepted: ['EX-db-expert-1'],
        declined: [],
        conflicts: [],
        gaps: [],
        questions: [],
        tokens: 0,
      }),
    ]);
    const { out } = await run(root, [
      'record',
      'questions',
      writeJson(root, 'q.json', { questions: [] }),
    ]);
    expect(JSON.parse(out[0]!).asked).toBe(1);
  });
});

describe('spec pipeline CLI — start', () => {
  function writeReq(root: string, body: string): string {
    const p = join(root, 'request.md');
    writeFileSync(p, body, 'utf8');
    return p;
  }

  it('grounds and labels from a request file, writing request.md and printing the next step', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const req = writeReq(root, 'Let customers download their invoices as CSV.');
    const { out } = await run(root, ['start', '--request-file', req]);
    const result = JSON.parse(out[0]!);
    expect(result).toHaveProperty('label');
    expect(result).toHaveProperty('next_step');
    expect(result.experts).toBe('off');
    const request = readFileSync(join(root, featureFilePath(dir, 'request')), 'utf8');
    expect(splitFrontMatter(request).body).toBe('Let customers download their invoices as CSV.');
    expect(splitFrontMatter(request).header).toMatchObject({ doc_type: 'paqad.request' });
    expect(existsSync(join(root, stagedFilePath(dir, 'grounding')))).toBe(true);
    expect(readClarification(root, dir)?.label).not.toBeNull();
  });

  it('errors when neither --request-file nor --ticket is given', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { err } = await run(root, ['start']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/needs --request-file/);
  });

  it('errors on an unreadable request file', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { err } = await run(root, ['start', '--request-file', join(root, 'missing.md')]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/could not read request file/);
  });

  it('refuses a Jira ticket ref (MCP-only)', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { err } = await run(root, ['start', '--ticket', 'PROJ-123']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/Atlassian MCP/);
  });
});

describe('spec pipeline CLI — start reuses its grounding', () => {
  const REQUEST = 'Let customers download their invoices as CSV.';

  function writeReq(root: string, body = REQUEST): string {
    const p = join(root, 'request.md');
    writeFileSync(p, body, 'utf8');
    return p;
  }

  function grounding(root: string, dir: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(root, stagedFilePath(dir, 'grounding')), 'utf8'));
  }

  function lastJson(out: string[]): Record<string, unknown> {
    return JSON.parse(out.at(-1)!);
  }

  it('AC-41: reuses a retrieval-mode grounding.json for the same request and prints grounding reused', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const seeded = {
      references: [{ kind: 'doc', ref: 'docs/modules/export/business.md' }],
      terms: ['Report export'],
      sparse: false,
      path: 'rag',
      mode: 'retrieval',
      request_digest: requestDigest(REQUEST),
      modules: [],
    };
    writeStagedJson(root, dir, 'grounding', seeded);
    const { out } = await run(root, ['start', '--request-file', writeReq(root)]);
    expect(out[0]).toBe('grounding reused');
    expect(lastJson(out).grounding).toBe('reused');
    expect(grounding(root, dir)).toEqual(seeded);
  });

  it('AC-41: rebuilds for a different request or other modules, without the reused line', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    writeStagedJson(root, dir, 'grounding', {
      references: [],
      terms: [],
      sparse: true,
      path: 'rag',
      mode: 'retrieval',
      request_digest: requestDigest('another request'),
      modules: [],
    });
    const { out } = await run(root, ['start', '--request-file', writeReq(root)]);
    expect(out).not.toContain('grounding reused');
    expect(grounding(root, dir).request_digest).toBe(requestDigest(REQUEST));
    const again = await run(root, [
      'start',
      '--request-file',
      writeReq(root),
      '--modules',
      'export',
    ]);
    expect(again.out).not.toContain('grounding reused');
    expect(grounding(root, dir).modules).toEqual(['export']);
  });

  it('AC-41: rebuilds a grounding.json that is not valid JSON instead of failing', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    mkdirSync(join(root, stagedFilePath(dir, 'grounding'), '..'), { recursive: true });
    writeFileSync(join(root, stagedFilePath(dir, 'grounding')), '{not json', 'utf8');
    const { out } = await run(root, ['start', '--request-file', writeReq(root)]);
    expect(process.exitCode).toBe(0);
    expect(out).not.toContain('grounding reused');
    expect(grounding(root, dir).request_digest).toBe(requestDigest(REQUEST));
  });

  it('AC-42: tries retrieval once more after a lexical fallback, then reuses the fallback', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const req = writeReq(root);
    const first = await run(root, ['start', '--request-file', req]);
    expect(lastJson(first.out)).toMatchObject({
      grounding: 'lexical-fallback',
      grounding_reason: 'rag-disabled',
    });
    expect(grounding(root, dir)).toMatchObject({ mode: 'lexical-fallback' });
    expect(grounding(root, dir)).not.toHaveProperty('fallback_retried');
    vi.restoreAllMocks();
    const second = await run(root, ['start', '--request-file', req]);
    expect(second.out).not.toContain('grounding reused');
    expect(grounding(root, dir)).toMatchObject({ fallback_retried: true });
    vi.restoreAllMocks();
    const third = await run(root, ['start', '--request-file', req]);
    expect(third.out[0]).toBe('grounding reused');
  });

  it('AC-24: writes no API key to stdout, stderr, grounding.json or the bundle', async () => {
    const SECRET_OPENAI = 'sk-test-openai-value-0123456789';
    const SECRET_COHERE = 'co-test-cohere-value-0123456789';
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_OPENAI_API_KEY', SECRET_OPENAI);
    vi.stubEnv('CLAUDE_PLUGIN_OPTION_COHERE_API_KEY', SECRET_COHERE);
    try {
      const root = tempRoot();
      const dir = activeFeature(root);
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(
        join(root, '.paqad', '.config'),
        'rag_enabled=true\nrag_embedding_provider=openai\n',
        'utf8',
      );
      const { out, err } = await run(root, ['start', '--request-file', writeReq(root)]);
      const bundle = join(root, featureFilePath(dir, 'request'), '..');
      const written = [
        ...out,
        ...err,
        readFileSync(join(root, stagedFilePath(dir, 'grounding')), 'utf8'),
        ...readdirSync(bundle, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8')),
      ].join('\n');
      expect(written).not.toContain(SECRET_OPENAI);
      expect(written).not.toContain(SECRET_COHERE);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('spec pipeline CLI — metrics + branches', () => {
  it('metrics reports the active run', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    writeStagedJson(root, dir, 'finish', { provenance: { outcome: 'freeze' } });
    writeExpertRoster(root, dir, [
      {
        role: 'db-expert',
        reason: 'r',
        lens: 'lens',
        budget_tokens: 6000,
        grounding_truncated: false,
        brief_hash: 'h',
        tokens_used: 500,
      },
    ]);
    const { out } = await run(root, ['metrics']);
    const report = JSON.parse(out[0]!);
    expect(report.runs).toBe(1);
    expect(out.join('\n')).toMatch(/db-expert/);
  });

  it('metrics --all aggregates across every feature bundle', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    writeStagedJson(root, dir, 'finish', {
      provenance: { metrics: { label: 'clear', grounding_sparse: false, tokens_by_step: {} } },
    });
    const { out } = await run(root, ['metrics', '--all']);
    expect(JSON.parse(out[0]!).runs).toBe(1);
  });

  it('start refuses an unrecognised ticket ref', async () => {
    const root = tempRoot();
    activeFeature(root);
    const { err } = await run(root, ['start', '--ticket', 'not-a-ref']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/not a GitHub issue ref/);
  });

  it('record craft refuses a malformed trace', async () => {
    const root = tempRoot();
    activeFeature(root);
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, '.paqad', '.config'), 'spec_pipeline_enabled=true', 'utf8');
    await run(root, ['ground']);
    await run(root, ['label', 'add a customer_id index to the invoices table']);
    await run(root, [
      'record',
      'questions',
      (() => {
        const p = join(root, 'q.json');
        writeFileSync(p, JSON.stringify({ questions: [] }));
        return p;
      })(),
    ]);
    await run(root, [
      'record',
      'task',
      (() => {
        const p = join(root, 't.json');
        writeFileSync(p, JSON.stringify({ intent: 'x' }));
        return p;
      })(),
    ]);
    const spec = join(root, 'spec.md');
    writeFileSync(
      spec,
      [
        '## Functional requirements',
        '- FR-1: x',
        '## Acceptance criteria',
        '- AC-1: given a, when b, then c (proof: automated)',
        '## Invariants',
        '- INV-1: y',
      ].join('\n'),
    );
    const badTrace = join(root, 'bad-trace.json');
    writeFileSync(badTrace, JSON.stringify({ entries: [{ id: 'ZZ-1', source: 's' }] }));
    process.exitCode = 0;
    const { err } = await run(root, ['record', 'craft', spec, '--trace', badTrace]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/malformed/);
  });
});
