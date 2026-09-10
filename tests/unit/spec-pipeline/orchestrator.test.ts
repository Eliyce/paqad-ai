import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertCanRunStep,
  hasExpertOrChiefQuestions,
  labelIsClear,
  nextStep,
  pipelineArtifactPath,
  pipelineScratchDir,
  readPipelineLog,
  readQuestionsArtifact,
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

const GROUNDING = JSON.stringify({
  references: [],
  terms: ['export'],
  sparse: false,
  path: 'docs-fallback',
});
const LABEL_OKAY = JSON.stringify({ label: 'okay', signals: [], question_budget: 3 });
const LABEL_CLEAR = JSON.stringify({ label: 'clear', signals: [], question_budget: 0 });
const QUESTIONS = JSON.stringify({
  questions: [],
  auto_answered: [],
  asked: 0,
  answered: 0,
  deferred: 0,
});
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

  it('accepts a raw questions batch carrying only questions[] (INV-3)', () => {
    expect(validateStepArtifact('questions', JSON.stringify({ questions: [] })).ok).toBe(true);
  });

  it('rejects a widened questions.json with a non-array auto_answered or a non-number count', () => {
    expect(
      validateStepArtifact('questions', JSON.stringify({ questions: [], auto_answered: 0 })).ok,
    ).toBe(false);
    expect(
      validateStepArtifact('questions', JSON.stringify({ questions: [], asked: 'many' })).ok,
    ).toBe(false);
  });
});

describe('readQuestionsArtifact', () => {
  it('reads the enriched shape with auto-answered refs and counts (issue #517)', () => {
    const root = tempRoot();
    writeStepArtifact(
      root,
      DIR,
      'questions',
      JSON.stringify({
        questions: [],
        auto_answered: [{ question: 'q?', answer: 'yes', source: 'D-9' }],
        asked: 2,
        answered: 1,
        deferred: 0,
      }),
    );
    const read = readQuestionsArtifact(root, DIR);
    expect(read).not.toBeNull();
    expect(read!.auto_answered).toEqual([{ question: 'q?', answer: 'yes', source: 'D-9' }]);
    expect(read!.asked).toBe(2);
    expect(read!.answered).toBe(1);
  });

  it('returns null when the questions step never ran, and defaults missing fields', () => {
    const root = tempRoot();
    expect(readQuestionsArtifact(root, DIR)).toBeNull();
    writeStepArtifact(root, DIR, 'questions', JSON.stringify({ questions: [] }));
    const read = readQuestionsArtifact(root, DIR);
    expect(read).toEqual({ questions: [], auto_answered: [], asked: 0, answered: 0, deferred: 0 });
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

// Issue #547 — the experts step and the tightened questions skip.
describe('experts step', () => {
  const NEED_ONE = JSON.stringify({ experts: [{ role: 'db-expert', reason: 'x' }] });
  const NEED_NONE = JSON.stringify({ experts: [] });
  const SYNTHESIS = JSON.stringify({
    verdict: 'ready',
    accepted: [],
    declined: [],
    conflicts: [],
    gaps: [],
  });

  function enableExperts(root: string): void {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', '.config'),
      ['spec_pipeline_enabled=true', 'spec_pipeline_experts_enabled=true'].join('\n'),
    );
  }
  function writeScratch(root: string, file: string, body: string): void {
    const abs = join(root, pipelineScratchDir(DIR), file);
    mkdirSync(join(root, pipelineScratchDir(DIR)), { recursive: true });
    writeFileSync(abs, body);
  }

  it('validateStepArtifact accepts a shaped synthesis and rejects a malformed one', () => {
    expect(validateStepArtifact('experts', SYNTHESIS).ok).toBe(true);
    expect(validateStepArtifact('experts', JSON.stringify({ verdict: 'ready' })).ok).toBe(false);
  });

  it('is complete-by-skip when the roster is off', () => {
    const root = tempRoot();
    expect(stepComplete(root, DIR, 'experts')).toBe(true);
  });

  it('is complete-by-skip when the recorded need names zero experts', () => {
    const root = tempRoot();
    enableExperts(root);
    writeScratch(root, 'experts.json', NEED_NONE);
    expect(stepComplete(root, DIR, 'experts')).toBe(true);
  });

  it('needs a valid synthesis when the roster is on and an expert was named', () => {
    const root = tempRoot();
    enableExperts(root);
    writeScratch(root, 'experts.json', NEED_ONE);
    expect(stepComplete(root, DIR, 'experts')).toBe(false);
    writeStepArtifact(root, DIR, 'experts', SYNTHESIS);
    expect(stepComplete(root, DIR, 'experts')).toBe(true);
  });

  it('questions is NOT skipped on a clear label when an expert question is pending (FR-7.3)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'label', LABEL_CLEAR);
    writeScratch(
      root,
      'expert-notes.json',
      JSON.stringify({
        notes: [{ role: 'db-expert', findings: [], questions: [{ business_text: 'q?' }] }],
      }),
    );
    expect(hasExpertOrChiefQuestions(root, DIR)).toBe(true);
    expect(stepComplete(root, DIR, 'questions')).toBe(false);
  });

  it('sees a chief gap question and a top-level synthesis question', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'experts', JSON.stringify({ gaps: [{ question: { x: 1 } }] }));
    expect(hasExpertOrChiefQuestions(root, DIR)).toBe(true);
    const root2 = tempRoot();
    writeStepArtifact(root2, DIR, 'experts', JSON.stringify({ questions: [{ x: 1 }] }));
    expect(hasExpertOrChiefQuestions(root2, DIR)).toBe(true);
  });

  it('questions IS skipped on a clear label when nothing is pending', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'label', LABEL_CLEAR);
    expect(hasExpertOrChiefQuestions(root, DIR)).toBe(false);
    expect(stepComplete(root, DIR, 'questions')).toBe(true);
  });

  it('locks questions while an expert conflict is pending (FR-6.4)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    writeStepArtifact(root, DIR, 'label', LABEL_CLEAR);
    const gate = assertCanRunStep(root, DIR, 'questions', { hasPendingExpertConflict: true });
    expect(gate.allowed).toBe(false);
    expect(gate.message).toMatch(/expert conflict is still pending/);
  });
});
