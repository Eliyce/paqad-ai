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
  await createSpecPipelineCommand().parseAsync(
    [...args, '--project-root', root, '--session', SES],
    { from: 'user' },
  );
  return { out, err };
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

  it('records a valid need artifact when the roster is on (FR-3/AC-8)', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    enableExperts(root);
    const file = writeArtifact(root, 'need.json', {
      experts: [{ role: 'db-expert', reason: 'adds the invoices migration' }],
    });
    const { out } = await run(root, ['experts', 'record', file]);
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(out[0]!)).toEqual({ recorded: 'expert-need', experts: 1 });
    expect(readExpertNeed(root, dir)).toEqual({
      experts: [{ role: 'db-expert', reason: 'adds the invoices migration' }],
    });
  });

  it('rejects a need artifact naming a role outside the roster (AC-8)', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    enableExperts(root);
    const file = writeArtifact(root, 'need.json', { experts: [{ role: 'wizard', reason: 'x' }] });
    const { err } = await run(root, ['experts', 'record', file]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/invalid/);
    expect(readExpertNeed(root, dir)).toBeNull();
  });

  it('errors when the need file cannot be read', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    const { err } = await run(root, ['experts', 'record', join(root, 'missing.json')]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/could not read need artifact/);
  });

  it('records a valid notes artifact', async () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    enableExperts(root);
    const file = writeArtifact(root, 'notes.json', {
      notes: [{ role: 'db-expert', findings: [{ target: 'invoices', claim: 'index it' }] }],
      tokens: { 'db-expert': 700 },
    });
    const { out } = await run(root, ['experts', 'notes', file]);
    expect(JSON.parse(out[0]!)).toEqual({ recorded: 'expert-notes', notes: 1 });
    expect(readExpertNotes(root, dir)).toMatchObject({
      tokens: { 'db-expert': 700 },
    });
  });

  it('rejects an invalid notes artifact and refuses notes when off', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
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

  it('folds the expert accounting into finish provenance only when experts ran (AC-7)', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    // Drive the pipeline to finish: ground, label(clear so questions skip), task, craft, experts, finish.
    await run(root, ['ground']);
    await run(root, ['label', 'add a customer_id index to the invoices table for faster lookups']);
    // questions may be required (label not clear); record an empty batch to satisfy the lock.
    const q = writeArtifact(root, 'questions.json', { questions: [] });
    await run(root, ['record', 'questions', q]);
    // task + craft are agent artifacts handed back via record.
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

  it('errors when the notes file cannot be read', async () => {
    const root = tempRoot();
    activeFeature(root);
    enableExperts(root);
    const { err } = await run(root, ['experts', 'notes', join(root, 'missing.json')]);
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/could not read notes artifact/);
  });
});

