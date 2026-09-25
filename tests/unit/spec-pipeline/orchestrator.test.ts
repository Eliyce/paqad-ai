import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { sha256Hex } from '@/compliance/markdown.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import {
  assertCanRunStep,
  hasExpertOrChiefQuestions,
  labelIsClear,
  nextStep,
  readQuestionsArtifact,
  readStepArtifact,
  recordStep,
  redoStep,
  stepComplete,
  validateStepArtifact,
  writeStepArtifact,
} from '@/spec-pipeline/orchestrator.js';
import {
  readClarification,
  readSpecStepRows,
  stagedFilePath,
  writeExpertNotes,
  writeExpertRoster,
  type ExpertRosterEntry,
} from '@/spec-pipeline/run-store.js';

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
const SYNTHESIS = JSON.stringify({
  verdict: 'ready',
  accepted: [],
  declined: [],
  conflicts: [],
  gaps: [],
  questions: [],
  tokens: 0,
});

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
    expect(read).not.toHaveProperty('deferred_from_experts');
  });

  it('returns null when the questions step never ran', () => {
    expect(readQuestionsArtifact(tempRoot(), DIR)).toBeNull();
  });

  it('round-trips the questions the expert cap held back (issue #581, FR-9)', () => {
    const root = tempRoot();
    const held = { business_text: 'q?', why_it_matters: 'w', options: ['a'], grounded_in: null };
    writeStepArtifact(
      root,
      DIR,
      'questions',
      JSON.stringify({
        questions: [],
        auto_answered: [],
        asked: 0,
        answered: 0,
        deferred: 1,
        deferred_from_experts: [held],
      }),
    );
    // Stored as the clarification.json questions section: asked, auto_answered, deferred, counts.
    expect(readClarification(root, DIR)?.questions).toEqual({
      asked: [],
      auto_answered: [],
      deferred: [held],
      counts: { asked: 0, answered: 0, auto_answered: 0, deferred: 1 },
    });
    expect(readQuestionsArtifact(root, DIR)?.deferred_from_experts).toEqual([held]);
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

describe('spec-step rows + resume + redo (issue #581)', () => {
  it('records a spec-step row with the artifact hash and no enforcement block (FR-1.5, AC-11)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    const row = recordStep(root, DIR, 'ground', 'complete', {
      sessionId: 'ses-1',
      now: () => new Date('2026-09-04T00:00:00Z'),
    });
    expect(row).toMatchObject({
      kind: 'spec-step',
      step: 'ground',
      outcome: 'complete',
      artifact_hash: sha256Hex(GROUNDING),
      session_id: 'ses-1',
      recorded_at: '2026-09-04T00:00:00.000Z',
    });
    expect(row).not.toHaveProperty('enforcement');
    expect(row).not.toHaveProperty('tokens');
    expect(readSpecStepRows(root, DIR)).toHaveLength(1);
  });

  it('hashes a missing artifact as empty and keeps only whole, non-negative tokens', () => {
    const root = tempRoot();
    expect(recordStep(root, DIR, 'task', 'skipped', { tokens: 42 })).toMatchObject({
      outcome: 'skipped',
      artifact_hash: '',
      tokens: 42,
    });
    for (const tokens of [2.5, -1, 'many']) {
      expect(recordStep(root, DIR, 'task', 'complete', { tokens })).not.toHaveProperty('tokens');
    }
  });

  it('redo clears a step and everything downstream, one redone row each, no .redo- files (FR-1.3, AC-25)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    writeStepArtifact(root, DIR, 'label', LABEL_OKAY);
    writeStepArtifact(root, DIR, 'task', TASK);
    const labelBefore = readStepArtifact(root, DIR, 'label')!;
    const invalidated = redoStep(root, DIR, 'label');
    expect(invalidated).toEqual(['label', 'task']);
    expect(readClarification(root, DIR)?.label).toBeNull();
    expect(existsSync(join(root, stagedFilePath(DIR, 'task')))).toBe(false);
    // ground (upstream of the redo point) is untouched.
    expect(readStepArtifact(root, DIR, 'ground')).toBe(GROUNDING);
    const rows = readSpecStepRows(root, DIR);
    expect(rows.map((row) => [row.step, row.outcome])).toEqual([
      ['label', 'redone'],
      ['task', 'redone'],
    ]);
    expect(rows[0]?.artifact_hash).toBe(sha256Hex(labelBefore));
    const staged = readdirSync(join(root, stagedFilePath(DIR, 'task'), '..'));
    expect(staged.some((name) => name.includes('.redo-'))).toBe(false);
  });

  it('redo of the experts step clears only the synthesis section; the questions section too', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'experts', SYNTHESIS);
    writeStepArtifact(root, DIR, 'questions', QUESTIONS);
    expect(redoStep(root, DIR, 'experts')).toEqual(['experts', 'questions']);
    expect(readStepArtifact(root, DIR, 'experts')).toBeNull();
    expect(readStepArtifact(root, DIR, 'questions')).toBeNull();
    // Nothing left to clear: a second redo invalidates nothing and writes no row.
    expect(redoStep(root, DIR, 'experts')).toEqual([]);
    expect(readSpecStepRows(root, DIR)).toHaveLength(2);
  });

  it('stages working state under .paqad/tmp and bundle facts in the bundle, never the old scratch (AC-2)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'ground', GROUNDING);
    writeStepArtifact(root, DIR, 'label', LABEL_OKAY);
    writeStepArtifact(root, DIR, 'craft', CRAFT);
    writeStepArtifact(root, DIR, 'finish', FINISH);
    expect(stagedFilePath(DIR, 'grounding')).toBe(
      '.paqad/tmp/spec-pipeline/01JABCDEFGHJKMNPQRSTVWXYZ0/grounding.json',
    );
    expect(readFileSync(join(root, stagedFilePath(DIR, 'grounding')), 'utf8')).toBe(GROUNDING);
    expect(readFileSync(join(root, stagedFilePath(DIR, 'craft')), 'utf8')).toBe(CRAFT);
    expect(existsSync(join(root, featureFilePath(DIR, 'clarification')))).toBe(true);
    // The frozen spec is never written before freeze (INV-12).
    expect(existsSync(join(root, featureFilePath(DIR, 'specification')))).toBe(false);
    expect(readdirSync(join(root, '.paqad'))).not.toContain('_specs');
    expect(readdirSync(join(root, featureDir(DIR))).sort()).toEqual(['clarification.json']);
  });
});

// Issue #547 — the experts step and the tightened questions skip.
describe('experts step', () => {
  const DB_EXPERT: ExpertRosterEntry = {
    role: 'db-expert',
    reason: 'x',
    lens: 'lens',
    budget_tokens: 6000,
    grounding_truncated: false,
    brief_hash: 'h',
    tokens_used: null,
  };

  function enableExperts(root: string): void {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', '.config'),
      ['spec_pipeline_enabled=true', 'spec_pipeline_experts_enabled=true'].join('\n'),
    );
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
    writeExpertRoster(root, DIR, []);
    expect(stepComplete(root, DIR, 'experts')).toBe(true);
  });

  it('needs a valid synthesis when the roster is on and an expert was named', () => {
    const root = tempRoot();
    enableExperts(root);
    writeExpertRoster(root, DIR, [DB_EXPERT]);
    expect(stepComplete(root, DIR, 'experts')).toBe(false);
    writeStepArtifact(root, DIR, 'experts', SYNTHESIS);
    expect(stepComplete(root, DIR, 'experts')).toBe(true);
  });

  it('questions is NOT skipped on a clear label when an expert question is pending (FR-7.3)', () => {
    const root = tempRoot();
    writeStepArtifact(root, DIR, 'label', LABEL_CLEAR);
    writeExpertRoster(root, DIR, [DB_EXPERT]);
    writeExpertNotes(root, DIR, {
      notes: [
        {
          role: 'db-expert',
          findings: [],
          questions: [
            { business_text: 'q?', why_it_matters: 'w', options: ['a'], grounded_in: null },
          ],
        },
      ],
      tokens: {},
    });
    expect(hasExpertOrChiefQuestions(root, DIR)).toBe(true);
    expect(stepComplete(root, DIR, 'questions')).toBe(false);
  });

  it('sees a chief gap question and a top-level synthesis question', () => {
    const root = tempRoot();
    const synthesis = JSON.parse(SYNTHESIS) as Record<string, unknown>;
    writeStepArtifact(
      root,
      DIR,
      'experts',
      JSON.stringify({ ...synthesis, gaps: [{ area: 'a', why_it_matters: 'w', question: {} }] }),
    );
    expect(hasExpertOrChiefQuestions(root, DIR)).toBe(true);
    const root2 = tempRoot();
    writeStepArtifact(root2, DIR, 'experts', JSON.stringify({ ...synthesis, questions: [{}] }));
    expect(hasExpertOrChiefQuestions(root2, DIR)).toBe(true);
    // A synthesis with neither a question nor a gap question asks nothing.
    const root3 = tempRoot();
    writeStepArtifact(
      root3,
      DIR,
      'experts',
      JSON.stringify({ ...synthesis, gaps: [{ area: 'a', why_it_matters: 'w' }] }),
    );
    expect(hasExpertOrChiefQuestions(root3, DIR)).toBe(false);
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
