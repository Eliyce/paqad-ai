import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { readExpertNeed, readExpertNotes } from '@/spec-pipeline/experts/notes.js';

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
  await createSpecPipelineCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
    from: 'user',
  });
  return { out, err };
}

/** Run S0 ground + S1 label so the experts step lock (FR-2.3) is satisfied. */
async function groundAndLabel(root: string, prompt = 'add a customer_id index to invoices'): Promise<void> {
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

  it('records a valid need artifact and writes one brief per expert (FR-3/AC-4)', async () => {
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
    expect(result).toMatchObject({ recorded: 'expert-need', experts: 1 });
    expect(result.briefs).toHaveLength(1);
    expect(result.briefs[0]).toMatch(/briefs\/db-expert\.md$/);
    expect(readExpertNeed(root, dir)).toEqual({
      experts: [{ role: 'db-expert', reason: 'adds the invoices migration' }],
    });
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
    const stored = readExpertNotes(root, dir) as {
      notes: { findings: { id: string; kind: string }[] }[];
    };
    expect(stored.notes[0]!.findings[0]!.id).toBe('EX-db-expert-1');
    expect(stored.notes[0]!.findings[0]!.kind).toBe('requirement');
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
      notes: [{ role: 'db-expert', findings: [{ target: 'invoices', claim: 'index customer_id' }] }],
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
    await run(root, ['record', 'craft', craftFile]);

    const { out } = await run(root, ['finish']);
    const result = JSON.parse(out[0]!);
    expect(result.step).toBe('finish');
    expect(result.experts).toBe(1);
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
