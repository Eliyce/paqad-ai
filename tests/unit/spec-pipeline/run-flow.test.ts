// Issue #581 (FR-1, AC-2) — one whole pipeline run, verb by verb, in a temp project: start,
// the three expert verbs, questions, task, craft, finish, then freeze. The retired per-feature
// scratch folder must not exist after ANY verb, not only at the end, and every bundle fact must
// land in the bundle through a verb. After freeze the run lives in specification.json alone
// (AC-9, AC-10, AC-11) and nothing it wrote is left in .paqad/tmp (AC-3).

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

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSpecCommand } from '@/cli/commands/spec.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import { readFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
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
          { id: 'AC-1', source: 'ticket:acceptance' },
          { id: 'INV-1', source: 'EX-db-expert-1' },
        ],
      }),
    );
    // Before freeze the bundle holds no specification.json (INV-12).
    expect(existsSync(join(root, featureDir(dir), 'specification.json'))).toBe(false);
    await pipeline('finish');
    await pipeline('status');

    // Every handed-in .paqad/tmp input is remembered for freeze to delete (FR-4).
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
    expect(existsSync(join(root, '.paqad', 'tmp', 'spec-pipeline'))).toBe(true);
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
    const spec = readFeatureSpecification(root, dir)!;
    expect(spec.pipeline?.produced).toBe(true);

    // AC-9 — one spec source: spec.md's body hashes to spec_hash, and nothing points elsewhere.
    const specMd = readFileSync(join(root, featureFilePath(dir, 'specMd')), 'utf8');
    expect(sha256Hex(splitFrontMatter(specMd).body)).toBe(spec.spec_hash);
    expect(spec.spec_file).toBe('spec.md');
    expect('provenance' in spec).toBe(false);
    expect(JSON.stringify(spec)).not.toContain('run_dir');
    expect(bundle).not.toContain('specification.md');

    // AC-10 — every behaviour, acceptance criterion and invariant has one trace entry, sourced
    // from a ticket section or an expert finding that exists in experts.json.
    const ids = [
      ...spec.behaviour.map((line) => /^(?:FR|NFR)-\d+/.exec(line)![0]),
      ...spec.acceptance_criteria.map((criterion) => criterion.criterion_id),
      ...spec.invariants.map((invariant) => invariant.invariant_id),
    ];
    expect(ids).toEqual(['FR-1', 'AC-1', 'INV-1']);
    const findingIds = new Set(experts.findings!.map((finding) => finding.id));
    for (const id of ids) {
      const source = spec.trace?.[id];
      expect(source, id).toBeTruthy();
      expect(source!.startsWith('ticket:') || findingIds.has(source!), `${id} -> ${source}`).toBe(
        true,
      );
    }
    expect(Object.keys(spec.trace!).sort()).toEqual([...ids].sort());
    expect(spec.task?.intent).toBe('index invoices');
    expect(spec.grounding && 'terms' in spec.grounding).toBe(false);

    // AC-11 — the enforcement block is stored once in the whole bundle, in the pipeline section.
    expect(spec.pipeline?.enforcement).toMatchObject({ experts_enabled: true });
    const enforcementCount = bundle
      .filter((name) => /\.(json|jsonl|md)$/.test(name))
      .map((name) => readFileSync(join(root, featureDir(dir), name), 'utf8'))
      .reduce((sum, text) => sum + (text.match(/"enforcement"/g)?.length ?? 0), 0);
    expect(enforcementCount).toBe(1);

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

    // AC-3 — nothing the pipeline or freeze wrote for this change is left in .paqad/tmp: no
    // handed-in input and no staging dir.
    expect(readdirSync(join(root, '.paqad', 'tmp'))).toEqual([]);
    expect(readRememberedInputs(root, dir)).toEqual([]);
  });
});
