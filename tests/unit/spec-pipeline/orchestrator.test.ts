import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertCanRunStep,
  labelIsClear,
  nextStep,
  pipelineArtifactPath,
  pipelineScratchDir,
  readPipelineLog,
  recordStep,
  redoStep,
  stepComplete,
  validateStepArtifact,
  writeStepArtifact,
} from '@/spec-pipeline/orchestrator.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-sp-orch-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const DIR = '512-x-01JABCDEFGHJKMNPQRSTVWXYZ0';

const GROUNDING = JSON.stringify({ references: [], terms: ['export'], sparse: false });
const LABEL_OKAY = JSON.stringify({ label: 'okay', signals: [], question_budget: 3 });
const LABEL_CLEAR = JSON.stringify({ label: 'clear', signals: [], question_budget: 0 });
const QUESTIONS = JSON.stringify({ questions: [], auto_answered: 0 });
const TASK = JSON.stringify({ intent: 'do the thing', assumptions: [], unresolved: [] });
const CRAFT = [
  '## Functional requirements',
  'FR-1: x.',
  '## Acceptance criteria',
  '- AC-1: Given a, when b, then c (proof: automated).',
].join('\n');
const FINISH = JSON.stringify({ outcome: 'frozen' });

describe('validateStepArtifact', () => {
  it('rejects a missing artifact naming the file', () => {
    const r = validateStepArtifact('ground', null);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('grounding.json');
  });

  it('rejects non-JSON for a JSON step', () => {
    expect(validateStepArtifact('label', 'not json').ok).toBe(false);
  });

  it('validates each step shape', () => {
    expect(validateStepArtifact('ground', GROUNDING).ok).toBe(true);
    expect(validateStepArtifact('label', LABEL_OKAY).ok).toBe(true);
    expect(validateStepArtifact('questions', QUESTIONS).ok).toBe(true);
    expect(validateStepArtifact('task', TASK).ok).toBe(true);
    expect(validateStepArtifact('craft', CRAFT).ok).toBe(true);
    expect(validateStepArtifact('finish', FINISH).ok).toBe(true);
  });

  it('rejects a bad label value and an empty task intent', () => {
    expect(
      validateStepArtifact(
        'label',
        JSON.stringify({ label: 'meh', signals: [], question_budget: 0 }),
      ).ok,
    ).toBe(false);
    expect(validateStepArtifact('task', JSON.stringify({ intent: '' })).ok).toBe(false);
  });

  it('rejects a crafted spec that fails the shape check', () => {
    expect(validateStepArtifact('craft', '## Functional requirements\nFR-1: x.\n').ok).toBe(false);
  });
});

describe('step machine', () => {
  it('nextStep walks forward as artifacts are written', () => {
    const root = tempRoot();
    expect(nextStep(root, DIR)).toBe('ground');
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    expect(nextStep(root, DIR)).toBe('label');
    writeStepArtifact(root, DIR, 'label', LABEL_OKAY);
    expect(nextStep(root, DIR)).toBe('questions');
    writeStepArtifact(root, DIR, 'questions', QUESTIONS);
    writeStepArtifact(root, DIR, 'task', TASK);
    writeStepArtifact(root, DIR, 'craft', CRAFT);
    writeStepArtifact(root, DIR, 'finish', FINISH);
    expect(nextStep(root, DIR)).toBeNull();
  });

  it('skips the question round when the label is clear (FR-3.4)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    writeStepArtifact(root, DIR, 'label', LABEL_CLEAR);
    expect(labelIsClear(root, DIR)).toBe(true);
    expect(stepComplete(root, DIR, 'questions')).toBe(true);
    expect(nextStep(root, DIR)).toBe('task');
  });

  it('locks a step until its predecessor is complete (FR-1.2 / AC-10)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    const gate = assertCanRunStep(root, DIR, 'task');
    expect(gate.allowed).toBe(false);
    expect(gate.missing).toBe('label');
    expect(gate.message).toContain('label');
  });

  it('allows a step when every predecessor is complete', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    writeStepArtifact(root, DIR, 'label', LABEL_CLEAR);
    expect(assertCanRunStep(root, DIR, 'task').allowed).toBe(true);
  });
});

describe('run log + resume + redo', () => {
  it('records a completion row with hash and enforcement snapshot (FR-1.5)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    const row = recordStep(root, DIR, 'ground', 'complete', () => new Date('2026-09-04T00:00:00Z'));
    expect(row.step).toBe('ground');
    expect(row.hash).toHaveLength(64);
    expect(row.enforcement.enabled).toBe(false);
    const log = readPipelineLog(root, DIR);
    expect(log).toHaveLength(1);
    expect(log[0]?.ts).toBe('2026-09-04T00:00:00.000Z');
  });

  it('redo archives a step and everything downstream (FR-1.3)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    writeStepArtifact(root, DIR, 'label', LABEL_OKAY);
    writeStepArtifact(root, DIR, 'task', TASK);
    const invalidated = redoStep(root, DIR, 'label');
    expect(invalidated).toEqual(['label', 'task']);
    expect(existsSync(join(root, pipelineArtifactPath(DIR, 'label')))).toBe(false);
    // ground (upstream of the redo point) is untouched.
    expect(existsSync(join(root, pipelineArtifactPath(DIR, 'ground')))).toBe(true);
  });

  it('writes scratch only under the pipeline dir, never the bundle (INV-6)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    const scratch = pipelineScratchDir(DIR);
    expect(scratch).toBe(join('.paqad', '_specs', DIR, 'pipeline'));
    expect(readFileSync(join(root, pipelineArtifactPath(DIR, 'ground')), 'utf8')).toBe(GROUNDING);
    expect(existsSync(join(root, '.paqad', 'ledger'))).toBe(false);
  });
});
