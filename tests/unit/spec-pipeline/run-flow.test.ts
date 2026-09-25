// Issue #581 (FR-1, AC-2) — one whole pipeline run, verb by verb, in a temp project: start,
// the three expert verbs, questions, task, craft, finish, then freeze. The retired per-feature
// scratch folder must not exist after ANY verb, not only at the end, and every bundle fact must
// land in the bundle through a verb.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSpecCommand } from '@/cli/commands/spec.js';
import { readFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { featureDir } from '@/feature-evidence/paths.js';
import { openFeatureChange, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import {
  readClarification,
  readExperts,
  readRememberedInputs,
  readSpecStepRows,
} from '@/spec-pipeline/run-store.js';

const SES = 'ses_run_flow';
const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

const SPEC = [
  '# Invoice index',
  '',
  '## Functional requirements',
  '- FR-1: Looking up a customer invoices uses an index on invoices.customer_id.',
  '',
  '## Acceptance criteria',
  '- AC-1: given a customer, when their invoices are listed, then the lookup uses the index. (proof: automated)',
  '',
  '## Invariants',
  '- INV-1: The invoices table keeps its customer_id index.',
  '',
].join('\n');

describe('a whole spec pipeline run never touches the old scratch folder (AC-2)', () => {
  it('start -> experts -> questions -> task -> craft -> finish -> freeze', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-run-flow-'));
    roots.push(root);
    mkdirSync(join(root, '.paqad', 'tmp'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', '.config'),
      ['spec_pipeline_enabled=true', 'spec_pipeline_experts_enabled=true'].join('\n'),
      'utf8',
    );
    const dir = openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'invoice index',
      issue: '581',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });

    /** Hand an input to a verb the way an agent does: a file under `.paqad/tmp/`. */
    const tmpInput = (name: string, value: unknown): string => {
      const path = join(root, '.paqad', 'tmp', name);
      writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
      return path;
    };

    const run = async (...args: string[]): Promise<string[]> => {
      const out: string[] = [];
      const err: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((line?: unknown) => void out.push(String(line)));
      vi.spyOn(console, 'error').mockImplementation(
        (line?: unknown) => void err.push(String(line)),
      );
      await createSpecCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
        from: 'user',
      });
      vi.restoreAllMocks();
      expect(err, `${args.join(' ')} failed`).toEqual([]);
      expect(process.exitCode ?? 0).toBe(0);
      // The heart of AC-2: checked after every single verb.
      expect(existsSync(join(root, '.paqad', '_specs'))).toBe(false);
      return out;
    };

    const pipeline = (...args: string[]): Promise<string[]> => run('pipeline', ...args);

    await pipeline(
      'start',
      '--request-file',
      tmpInput('request.md', 'Add a customer_id index to the invoices table.'),
    );
    await pipeline(
      'experts',
      'record',
      tmpInput('need.json', { experts: [{ role: 'db-expert', reason: 'adds an index' }] }),
    );
    const brief = await pipeline('experts', 'brief', 'db-expert');
    expect(brief[0]).toContain('# Expert brief — db-expert');
    await pipeline(
      'experts',
      'notes',
      tmpInput('notes.json', {
        notes: [
          { role: 'db-expert', findings: [{ target: 'invoices', claim: 'index customer_id' }] },
        ],
        tokens: { 'db-expert': 900 },
      }),
    );
    await pipeline('experts', 'context');
    await pipeline(
      'experts',
      'synthesis',
      tmpInput('synthesis.json', {
        verdict: 'ready',
        accepted: ['EX-db-expert-1'],
        declined: [],
        conflicts: [],
        gaps: [],
        questions: [],
        tokens: 300,
      }),
    );
    await pipeline('record', 'questions', tmpInput('questions.json', { questions: [] }));
    await pipeline('record', 'task', tmpInput('task.json', { intent: 'index invoices' }));
    const specPath = tmpInput('spec.md', SPEC);
    await pipeline(
      'record',
      'craft',
      specPath,
      '--trace',
      tmpInput('trace.json', {
        entries: [
          { id: 'FR-1', source: 'EX-db-expert-1' },
          { id: 'AC-1', source: 'task.intent' },
          { id: 'INV-1', source: 'EX-db-expert-1' },
        ],
      }),
    );
    // Before freeze the bundle holds no specification.json (INV-12).
    expect(existsSync(join(root, featureDir(dir), 'specification.json'))).toBe(false);
    await pipeline('finish');
    await pipeline('status');
    await run(
      'freeze',
      specPath,
      '--from-pipeline',
      '--signed-off-by',
      'tester',
      '--confirm-invariants',
    );

    // The bundle facts landed in the bundle, each through its verb.
    const bundle = readdirSync(join(root, featureDir(dir))).sort();
    expect(bundle).toEqual(
      expect.arrayContaining([
        'clarification.json',
        'experts.json',
        'request.md',
        'spec.md',
        'specification.json',
        'stage-evidence.jsonl',
      ]),
    );
    expect(bundle).not.toContain('briefs');
    expect(bundle.filter((name) => name.endsWith('.md')).sort()).toEqual(['request.md', 'spec.md']);
    expect(readClarification(root, dir)?.label?.value).toBeDefined();
    expect(readClarification(root, dir)?.questions?.counts.asked).toBe(0);
    const experts = readExperts(root, dir)!;
    expect(experts.findings!.map((finding) => finding.id)).toEqual(['EX-db-expert-1']);
    expect(experts.synthesis?.accepted).toEqual(['EX-db-expert-1']);
    expect(readFeatureSpecification(root, dir)?.provenance?.pipeline_produced).toBe(true);

    // One spec-step row per recorded step, none carrying the enforcement block (AC-11).
    const steps = readSpecStepRows(root, dir);
    expect(steps.map((row) => row.step)).toEqual([
      'ground',
      'label',
      'experts',
      'questions',
      'task',
      'craft',
      'finish',
    ]);
    expect(readFeatureStageUnit(root, dir).some((row) => 'enforcement' in row)).toBe(false);

    // Every handed-in .paqad/tmp input is remembered for freeze to delete (FR-4, S12).
    expect(readRememberedInputs(root, dir)).toEqual([
      '.paqad/tmp/request.md',
      '.paqad/tmp/need.json',
      '.paqad/tmp/notes.json',
      '.paqad/tmp/synthesis.json',
      '.paqad/tmp/questions.json',
      '.paqad/tmp/task.json',
      '.paqad/tmp/spec.md',
      '.paqad/tmp/trace.json',
    ]);
  });
});
