import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { featureStagePath } from '@/feature-evidence/stage-ledger.js';
import { recordStep, writeStepArtifact } from '@/spec-pipeline/orchestrator.js';
import {
  appendSpecStepRow,
  writeExpertNotes,
  writeExpertRoster,
  writeExpertSynthesis,
  writeStagedJson,
  writeStagedText,
  type ExpertRosterEntry,
  type StagedFile,
} from '@/spec-pipeline/run-store.js';
import type { ExpertSynthesis } from '@/spec-pipeline/experts/synthesis.js';
import {
  aggregateSpecPipelineMetrics,
  buildRunMetrics,
  listRunDirs,
  readSpecCorrections,
  recordSpecCorrection,
} from '@/spec-pipeline/metrics.js';
import type { PipelineConfig } from '@/spec-pipeline/config.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-metrics-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const CONFIG: PipelineConfig = {
  enabled: true,
  clarification: 'strict',
  final_review: 'off',
  token_ceiling: 60000,
  experts_enabled: true,
  adoption: 'strict',
};

const DIR = '547-metrics-01JABCDEFGHJKMNPQRSTVWXYZ0';
function stage(root: string, file: StagedFile, value: unknown): void {
  if (typeof value === 'string') writeStagedText(root, DIR, file, value);
  else writeStagedJson(root, DIR, file, value);
}
const SYNTHESIS: ExpertSynthesis = {
  verdict: 'ready',
  accepted: [],
  declined: [],
  conflicts: [],
  gaps: [],
  questions: [],
  tokens: 700,
};

const SPEC = [
  '## Functional requirements',
  '- FR-1: index invoices.customer_id',
  '## Acceptance criteria',
  '- AC-1: given a lookup, when it runs, then it uses the index (proof: automated)',
  '## Invariants',
  '- INV-1: the index exists',
].join('\n');

describe('buildRunMetrics', () => {
  it('measures the run from its artifacts (FR-11.1)', () => {
    const root = tempRoot();
    stage(root, 'grounding', { references: [], terms: ['invoice'], sparse: true, path: 'rag' });
    writeStepArtifact(
      root,
      DIR,
      'label',
      JSON.stringify({
        label: 'okay',
        signals: [{ kind: 'too-short', span: 'y' }],
        question_budget: 3,
      }),
    );
    writeStepArtifact(
      root,
      DIR,
      'questions',
      JSON.stringify({
        questions: [],
        auto_answered: [{ question: 'q', answer: 'a', source: 'D-1' }],
        asked: 1,
        answered: 1,
        deferred: 0,
      }),
    );
    // The agent's question-round tokens ride on the step's latest complete spec-step row.
    recordStep(root, DIR, 'questions', 'skipped', { tokens: 1 });
    recordStep(root, DIR, 'task', 'complete', { tokens: 2 });
    recordStep(root, DIR, 'questions', 'complete', { tokens: 400 });
    stage(root, 'task', { intent: 'x', tokens: 200 });
    stage(root, 'trace', { entries: [], tokens: 900 });
    stage(root, 'craft', SPEC);
    writeExpertRoster(root, DIR, [
      {
        role: 'db-expert',
        reason: 'r',
        lens: 'lens',
        budget_tokens: 6000,
        grounding_truncated: false,
        brief_hash: 'h',
        tokens_used: null,
      },
    ]);
    writeExpertNotes(root, DIR, {
      notes: [{ role: 'db-expert', findings: [] }],
      tokens: { 'db-expert': 1100 },
    });
    writeExpertSynthesis(root, DIR, SYNTHESIS);

    const metrics = buildRunMetrics(root, DIR, CONFIG, true, 'live');
    expect(metrics.grounding_sparse).toBe(true);
    expect(metrics.grounding_path).toBe('rag');
    expect(metrics.label).toBe('okay');
    expect(metrics.signal_count).toBe(1);
    expect(metrics.questions).toEqual({ asked: 1, answered: 1, auto_answered: 1, deferred: 0 });
    expect(metrics.expert_count).toBe(1);
    expect(metrics.spec_words).toBeGreaterThan(0);
    expect(metrics.tokens_by_step.questions).toBe(400);
    expect(metrics.tokens_by_step.task).toBe(200);
    expect(metrics.tokens_by_step.craft).toBe(900);
    expect(metrics.tokens_by_step['db-expert']).toBe(1100);
    expect(metrics.tokens_by_step.experts).toBe(700);
    expect(metrics.tiers_by_step.experts).toBe('reasoning');
    expect(metrics.a5_live).toBe(true);
    expect(metrics.a5_verdict).toBe('live');
    // The spec is not confirmed at finish time, so the freeze would still fire the invariant check.
    expect(metrics.freeze_checks_fired.join(' ')).toMatch(/not human-confirmed/);
  });

  it('counts the experts from the roster before any notes are recorded', () => {
    const root = tempRoot();
    writeExpertRoster(root, DIR, [
      {
        role: 'db-expert',
        reason: 'r',
        lens: 'lens',
        budget_tokens: 6000,
        grounding_truncated: false,
        brief_hash: 'h',
        tokens_used: null,
      },
    ]);
    const metrics = buildRunMetrics(root, DIR, CONFIG, false, 'absent');
    expect(metrics.expert_count).toBe(1);
    expect(metrics.tokens_by_step).toEqual({});
  });

  it('degrades to neutral defaults for a bare run', () => {
    const root = tempRoot();
    const metrics = buildRunMetrics(root, DIR, CONFIG, false, 'absent');
    expect(metrics.grounding_sparse).toBe(false);
    expect(metrics.grounding_path).toBe('docs-fallback');
    expect(metrics.label).toBe('clear');
    expect(metrics.expert_count).toBe(0);
    expect(metrics.spec_words).toBe(0);
    expect(metrics.freeze_checks_fired).toEqual([]);
  });
});

describe('recordSpecCorrection', () => {
  it('appends a correction row and reads it back (FR-11.3)', () => {
    const root = tempRoot();
    expect(readSpecCorrections(root, DIR)).toEqual([]);
    recordSpecCorrection(root, DIR, {
      spec_id: 'S-1',
      changed_sections: ['acceptance_criteria'],
      at: '2026-09-10T00:00:00Z',
    });
    recordSpecCorrection(root, DIR, {
      spec_id: 'S-1',
      changed_sections: ['invariants'],
      at: '2026-09-11T00:00:00Z',
    });
    const rows = readSpecCorrections(root, DIR);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      spec_id: 'S-1',
      changed_sections: ['acceptance_criteria'],
      at: '2026-09-10T00:00:00.000Z',
    });
    // Stored as kind: 'spec-correction' rows on the bundle's stage evidence (issue #581).
    const ledger = readFileSync(join(root, featureStagePath(DIR)), 'utf8');
    expect(ledger).toContain('"kind":"spec-correction"');
  });
});

describe('aggregateSpecPipelineMetrics + listRunDirs', () => {
  const LEGACY = '540-legacy-01JABCDEFGHJKMNPQRSTVWXYZ1';
  const MANUAL = '541-manual-01JABCDEFGHJKMNPQRSTVWXYZ2';
  const STAGED = '542-staged-01JABCDEFGHJKMNPQRSTVWXYZ3';

  function writeSpecification(root: string, dirName: string, body: unknown): void {
    const path = join(root, featureFilePath(dirName, 'specification'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(body), 'utf8');
  }

  function roster(role: 'db-expert' | 'security-auditor'): ExpertRosterEntry {
    return {
      role,
      reason: 'r',
      lens: 'lens',
      budget_tokens: 6000,
      grounding_truncated: false,
      brief_hash: 'h',
      tokens_used: null,
    };
  }

  it('aggregates experts, tokens, corrections and labels from the bundles alone (FR-16)', () => {
    const root = tempRoot();
    // A change frozen since #581: the run lives in specification.json + the bundle files.
    writeExpertRoster(root, DIR, [roster('db-expert'), roster('security-auditor')]);
    writeExpertNotes(root, DIR, {
      notes: [
        { role: 'db-expert', findings: [{ id: 'EX-db-expert-1', target: 't', claim: 'c' }] },
        { role: 'security-auditor', findings: [] },
      ],
      tokens: { 'db-expert': 1000, 'security-auditor': 500 },
    });
    writeExpertSynthesis(root, DIR, {
      ...SYNTHESIS,
      auto_resolved: [{ target: 'x', chosen: 'c', source: 'D-1' }],
    });
    writeStepArtifact(
      root,
      DIR,
      'label',
      JSON.stringify({ label: 'okay', signals: [], question_budget: 3 }),
    );
    recordStep(root, DIR, 'craft', 'complete', { tokens: 100 });
    // A redo clears the step's tokens until it completes again.
    appendSpecStepRow(root, DIR, { step: 'craft', outcome: 'redone', artifactHash: '' });
    recordStep(root, DIR, 'task', 'complete', { tokens: 50 });
    appendSpecStepRow(root, DIR, { step: 'task', outcome: 'redone', artifactHash: '' });
    recordStep(root, DIR, 'craft', 'complete', { tokens: 900 });
    writeSpecification(root, DIR, {
      pipeline: { produced: true, outcome: 'freeze' },
      grounding: { path: 'rag', sparse: true, references: [] },
      trace: { 'FR-1': 'EX-db-expert-1' },
    });
    recordSpecCorrection(root, DIR, {
      spec_id: 'S-1',
      changed_sections: ['acceptance_criteria', 'invariants'],
      at: '2026-09-12T00:00:00Z',
    });

    // A change frozen before #581: its provenance block still counts (INV-8).
    writeSpecification(root, LEGACY, {
      provenance: {
        pipeline_produced: true,
        label: 'vague',
        grounding: { sparse: true, path: 'rag' },
        experts: { roles: ['db-expert'], accepted: 1, declined: 0, conflicts: 2, auto_resolved: 0 },
      },
    });

    // A hand-frozen change: no run, but its corrections still count.
    writeSpecification(root, MANUAL, { pipeline: { produced: false, manual_reason: 'hotfix' } });
    recordSpecCorrection(root, MANUAL, {
      spec_id: 'S-2',
      changed_sections: ['behaviour'],
      at: '2026-09-12T00:00:00Z',
    });

    // A change whose run is finished but not yet frozen.
    writeStagedJson(root, STAGED, 'finish', {
      outcome: 'freeze',
      provenance: { outcome: 'freeze' },
    });
    writeStagedJson(root, STAGED, 'grounding', {
      references: [],
      terms: [],
      sparse: false,
      path: 'rag',
    });
    mkdirSync(join(root, featureDir(STAGED)), { recursive: true });

    expect(listRunDirs(root)).toEqual([LEGACY, MANUAL, STAGED, DIR]);
    const report = aggregateSpecPipelineMetrics(root, listRunDirs(root));
    expect(report.runs).toBe(3);
    expect(report.experts_fired).toEqual({ 'db-expert': 2, 'security-auditor': 1 });
    // db-expert's finding is a trace source, so it changed the spec; the legacy run cannot say.
    expect(report.changed_spec_rate['db-expert']).toEqual({ fired: 2, changed: 1 });
    expect(report.changed_spec_rate['security-auditor']).toEqual({ fired: 1, changed: 0 });
    expect(report.tokens_by_role).toEqual({ 'db-expert': 1000, 'security-auditor': 500 });
    expect(report.tokens_by_step).toEqual({ craft: 900, experts: 700 });
    expect(report.conflicts).toBe(2);
    expect(report.auto_resolved).toBe(1);
    expect(report.corrections_by_section).toEqual({
      acceptance_criteria: 1,
      invariants: 1,
      behaviour: 1,
    });
    expect(report.label_distribution).toEqual({ okay: 1, vague: 1 });
    expect(report.grounding_sparse_runs).toBe(2);
  });

  it('takes the experts step tokens from its row over the synthesis', () => {
    const root = tempRoot();
    writeExpertSynthesis(root, DIR, SYNTHESIS);
    recordStep(root, DIR, 'experts', 'complete', { tokens: 42 });
    writeSpecification(root, DIR, { pipeline: { produced: true } });
    const report = aggregateSpecPipelineMetrics(root, [DIR]);
    expect(report.tokens_by_step).toEqual({ experts: 42 });
    expect(report.label_distribution).toEqual({});
    expect(report.grounding_sparse_runs).toBe(0);
  });

  it('returns a zeroed report and empty run list for an empty store', () => {
    const root = tempRoot();
    expect(listRunDirs(root)).toEqual([]);
    const report = aggregateSpecPipelineMetrics(root, []);
    expect(report.runs).toBe(0);
    expect(report.conflicts).toBe(0);
  });
});
