import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { featureDir } from '@/feature-evidence/paths.js';
import {
  readExpertNeed,
  readExpertNotes,
  readExperts,
  readSpecStepRows,
  stagingDir,
  writeRequest,
} from '@/spec-pipeline/run-store.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-experts-cli-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
  process.exitCode = 0;
});

const SES = 'ses_experts';
function activeFeature(root: string): string {
  return openFeatureChange(root, SES, {
    adapter: 'claude-code',
    title: 'experts cli',
    issue: '521',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
}

function enableExperts(root: string): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad', '.config'),
    ['spec_pipeline_enabled=true', 'spec_pipeline_experts_enabled=true'].join('\n'),
    'utf8',
  );
}

function writeArtifact(root: string, name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

async function run(root: string, args: string[]): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void out.push(String(m)));
  vi.spyOn(console, 'error').mockImplementation((m?: unknown) => void err.push(String(m)));
  await createSpecPipelineCommand().parseAsync(
    [...args, '--project-root', root, '--session', SES],
    {
      from: 'user',
    },
  );
  return { out, err };
}

/** Run S0 ground + S1 label so the experts step lock (FR-2.3) is satisfied. */
async function groundAndLabel(
  root: string,
  prompt = 'add a customer_id index to invoices',
): Promise<void> {
  await run(root, ['ground']);
  await run(root, ['label', prompt]);
}

describe('spec pipeline experts CLI', () => {
  beforeEach(() => {
    process.exitCode = 0;
  });

  it('refuses record when the roster is off (P2-INV-1)', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const file = writeArtifact(root, 'need.json', { experts: [] });
    const { err } = await run(root, ['experts', 'record', file]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/expert roster is off/);
    expect(readExpertNeed(root, dir)).toBeNull();
  });

  it('records a valid need as the experts.json roster, hashing each brief, writing no brief file (FR-3/AC-4)', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    const file = writeArtifact(root, 'need.json', {
      experts: [{ role: 'db-expert', reason: 'adds the invoices migration' }],
    });
    const { out } = await run(root, ['experts', 'record', file]);
    expect(process.exitCode).toBe(0);
    const result = JSON.parse(out[0]!);
    expect(result).toEqual({ recorded: 'expert-need', experts: 1, briefs: ['db-expert'] });
    expect(readExpertNeed(root, dir)).toEqual({
      experts: [{ role: 'db-expert', reason: 'adds the invoices migration' }],
    });
    const entry = readExperts(root, dir)!.roster[0]!;
    expect(entry).toMatchObject({
      role: 'db-expert',
      lens: 'runtime/base/skills/expert-notes/references/lenses/db-expert.md',
      grounding_truncated: false,
      tokens_used: null,
    });
    expect(entry.budget_tokens).toBeGreaterThan(0);
    // No brief is ever written to disk: not in the bundle, not in staging (AC-7).
    expect(readdirSync(join(root, featureDir(dir)))).not.toContain('briefs');
    expect(existsSync(join(root, stagingDir(dir), 'briefs'))).toBe(false);

    // The brief verb prints the brief whose sha256 the roster recorded (AC-8).
    const brief = await run(root, ['experts', 'brief', 'db-expert']);
    expect(process.exitCode).toBe(0);
    expect(brief.out[0]).toContain('# Expert brief — db-expert');
    expect(sha256Hex(brief.out[0]!)).toBe(entry.brief_hash);
  });

  it('records a zero-expert need as a skipped experts step', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    await run(root, ['experts', 'record', writeArtifact(root, 'need.json', { experts: [] })]);
    expect(readExperts(root, dir)?.roster).toEqual([]);
    const experts = readSpecStepRows(root, dir).filter((row) => row.step === 'experts');
    expect(experts.map((row) => row.outcome)).toEqual(['skipped']);
  });

  it('brief refuses when off, for a role off the roster, and when the run inputs moved', async () => {
    const off = tempRoot();
    activeFeature(off);
    const offRun = await run(off, ['experts', 'brief', 'db-expert']);
    expect(process.exitCode).toBe(1);
    expect(offRun.err.join('\n')).toMatch(/expert roster is off/);

    process.exitCode = 0;
    const root = tempRoot();
    const dir = activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    const unknown = await run(root, ['experts', 'brief', 'db-expert']);
    expect(process.exitCode).toBe(1);
    expect(unknown.err.join('\n')).toMatch(/not on the recorded roster/);

    process.exitCode = 0;
    await run(root, [
      'experts',
      'record',
      writeArtifact(root, 'need.json', { experts: [{ role: 'db-expert', reason: 'r' }] }),
    ]);
    // A changed request no longer rebuilds the recorded brief, so the verb refuses to print it.
    writeRequest(root, dir, 'a different request');
    const moved = await run(root, ['experts', 'brief', 'db-expert']);
    expect(process.exitCode).toBe(1);
    expect(moved.err.join('\n')).toMatch(/no longer matches/);

    // With the label redone there is nothing to rebuild the brief from.
    process.exitCode = 0;
    await run(root, ['redo', 'label']);
    const noLabel = await run(root, ['experts', 'brief', 'db-expert']);
    expect(process.exitCode).toBe(1);
    expect(noLabel.err.join('\n')).toMatch(/no grounding or label/);

    process.exitCode = 0;
    await run(root, ['redo', 'ground']);
    const noGrounding = await run(root, ['experts', 'brief', 'db-expert']);
    expect(process.exitCode).toBe(1);
    expect(noGrounding.err.join('\n')).toMatch(/no grounding or label/);
  });

  it('context prints the request, grounding, label and roster, then the notes and merge', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    const before = JSON.parse((await run(root, ['experts', 'context'])).out[0]!);
    expect(before).toMatchObject({ roster: [], notes: null, merge: null });
    expect(before.request).toBe('add a customer_id index to invoices');
    expect(before.label).toHaveProperty('label');
    await run(root, [
      'experts',
      'record',
      writeArtifact(root, 'need.json', { experts: [{ role: 'db-expert', reason: 'r' }] }),
    ]);
    await run(root, [
      'experts',
      'notes',
      writeArtifact(root, 'notes.json', {
        notes: [{ role: 'db-expert', findings: [{ target: 'invoices', claim: 'index it' }] }],
      }),
    ]);
    const after = JSON.parse((await run(root, ['experts', 'context'])).out[0]!);
    expect(after.roster).toHaveLength(1);
    expect(after.notes[0].findings[0].id).toBe('EX-db-expert-1');
    expect(after.merge.findings).toHaveLength(1);

    const off = tempRoot();
    activeFeature(off);
    await run(off, ['experts', 'context']);
    expect(process.exitCode).toBe(1);
  });

  it('rejects a need artifact naming a role outside the roster (AC-8)', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    const file = writeArtifact(root, 'need.json', { experts: [{ role: 'wizard', reason: 'x' }] });
    const { err } = await run(root, ['experts', 'record', file]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/invalid/);
    expect(readExpertNeed(root, dir)).toBeNull();
  });

  it('refuses the experts step before ground/label are complete (FR-2.3)', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    const file = writeArtifact(root, 'need.json', {
      experts: [{ role: 'db-expert', reason: 'x' }],
    });
    const { err } = await run(root, ['experts', 'record', file]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/earlier step/);
  });

  it('errors when the need file cannot be read', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    const { err } = await run(root, ['experts', 'record', join(root, 'missing.json')]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/could not read need artifact/);
  });

  it('records notes, assigns ids, and merges (AC-5)', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    await run(root, [
      'experts',
      'record',
      writeArtifact(root, 'need.json', { experts: [{ role: 'db-expert', reason: 'r' }] }),
    ]);
    const file = writeArtifact(root, 'notes.json', {
      notes: [{ role: 'db-expert', findings: [{ target: 'invoices', claim: 'index it' }] }],
      tokens: { 'db-expert': 700 },
    });
    const { out } = await run(root, ['experts', 'notes', file]);
    expect(JSON.parse(out[0]!)).toMatchObject({
      recorded: 'expert-notes',
      notes: 1,
      findings: 1,
      conflicts: 0,
    });
    const stored = readExpertNotes(root, dir)!;
    expect(stored.notes[0]!.findings[0]!.id).toBe('EX-db-expert-1');
    expect(stored.notes[0]!.findings[0]!.kind).toBe('requirement');
    // Each finding is stored once, in experts.json findings; the tokens land on the roster.
    const experts = readExperts(root, dir)!;
    expect(experts.findings!.map((finding) => finding.id)).toEqual(['EX-db-expert-1']);
    expect(experts.roster[0]!.tokens_used).toBe(700);
    expect(stored.tokens).toEqual({ 'db-expert': 700 });
  });

  it('rejects an invalid notes artifact and refuses notes when off', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    const bad = writeArtifact(root, 'notes.json', {
      notes: [{ role: 'implementer', findings: [] }],
    });
    await run(root, ['experts', 'notes', bad]);
    expect(process.exitCode).toBe(1);

    const root2 = tempRoot();
    activeFeature(root2);
    const file = writeArtifact(root2, 'notes.json', { notes: [] });
    const { err } = await run(root2, ['experts', 'notes', file]);
    expect(err.join('\n')).toMatch(/expert roster is off/);
  });

  it('errors when the notes file cannot be read', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    const { err } = await run(root, ['experts', 'notes', join(root, 'missing.json')]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/could not read notes artifact/);
  });

  it('folds the expert accounting into finish provenance only when experts ran (AC-7)', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    // Experts run BEFORE questions now (FR-2.1): record need, notes, then the chief synthesis.
    const need = writeArtifact(root, 'need.json', {
      experts: [{ role: 'db-expert', reason: 'adds an index to invoices' }],
    });
    await run(root, ['experts', 'record', need]);
    const notes = writeArtifact(root, 'notes.json', {
      notes: [
        { role: 'db-expert', findings: [{ target: 'invoices', claim: 'index customer_id' }] },
      ],
      tokens: { 'db-expert': 1100 },
    });
    await run(root, ['experts', 'notes', notes]);
    const synthesis = writeArtifact(root, 'synthesis.json', {
      verdict: 'ready',
      accepted: ['EX-db-expert-1'],
      declined: [],
      conflicts: [],
      gaps: [],
      questions: [],
      tokens: 200,
    });
    await run(root, ['experts', 'synthesis', synthesis]);
    // questions -> task -> craft -> finish.
    const q = writeArtifact(root, 'questions.json', { questions: [] });
    await run(root, ['record', 'questions', q]);
    const task = writeArtifact(root, 'task.json', { intent: 'index invoices' });
    await run(root, ['record', 'task', task]);
    const craftFile = join(root, 'spec.md');
    writeFileSync(
      craftFile,
      [
        '# Spec',
        '## Functional requirements',
        '- FR-1: index invoices.customer_id',
        '## Acceptance criteria',
        '- AC-1: Given a lookup, when it runs, then it uses the index (proof: automated)',
        '## Invariants',
        '- INV-1: the index exists',
      ].join('\n'),
      'utf8',
    );
    const trace = writeArtifact(root, 'trace.json', {
      entries: [
        { id: 'FR-1', source: 'EX-db-expert-1' },
        { id: 'AC-1', source: 'task.intent' },
        { id: 'INV-1', source: 'EX-db-expert-1' },
      ],
    });
    await run(root, ['record', 'craft', craftFile, '--trace', trace]);

    const { out } = await run(root, ['finish']);
    const result = JSON.parse(out[0]!);
    expect(result.step).toBe('finish');
    expect(result.experts).toBe(1);
  });

  it('every experts verb refuses without an active feature, and synthesis refuses when off', async () => {
    const root = tempRoot();
    enableExperts(root);
    for (const args of [
      ['experts', 'record', 'x.json'],
      ['experts', 'brief', 'db-expert'],
      ['experts', 'context'],
      ['experts', 'notes', 'x.json'],
      ['experts', 'synthesis', 'x.json'],
    ]) {
      process.exitCode = 0;
      const { err } = await run(root, args);
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toMatch(/no active feature/);
    }
    process.exitCode = 0;
    const off = tempRoot();
    activeFeature(off);
    const { err } = await run(off, ['experts', 'synthesis', 'x.json']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/expert roster is off/);
  });

  it('synthesis refuses before notes, and on an unreadable or invalid artifact', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    await groundAndLabel(root);
    const synthesis = writeArtifact(root, 'synthesis.json', { verdict: 'ready' });
    const early = await run(root, ['experts', 'synthesis', synthesis]);
    expect(process.exitCode).toBe(1);
    expect(early.err.join('\n')).toMatch(/no expert notes/);

    process.exitCode = 0;
    await run(root, [
      'experts',
      'record',
      writeArtifact(root, 'need.json', { experts: [{ role: 'db-expert', reason: 'r' }] }),
    ]);
    await run(root, [
      'experts',
      'notes',
      writeArtifact(root, 'notes.json', {
        notes: [{ role: 'db-expert', findings: [{ target: 'invoices', claim: 'index it' }] }],
      }),
    ]);
    const missing = await run(root, ['experts', 'synthesis', join(root, 'missing.json')]);
    expect(process.exitCode).toBe(1);
    expect(missing.err.join('\n')).toMatch(/could not read synthesis artifact/);

    process.exitCode = 0;
    const invalid = await run(root, ['experts', 'synthesis', synthesis]);
    expect(process.exitCode).toBe(1);
    expect(invalid.err.join('\n')).toMatch(/expert-synthesis artifact is invalid/);
  });

  it('finish refuses before the pipeline is ready (step lock)', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    const { err } = await run(root, ['finish']);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/earlier step/);
  });
});
