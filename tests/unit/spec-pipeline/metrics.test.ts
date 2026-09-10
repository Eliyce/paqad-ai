import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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

const DIR = 'change-1';
function scratch(root: string, dir = DIR): string {
  const p = join(root, '.paqad', '_specs', dir, 'pipeline');
  mkdirSync(p, { recursive: true });
  return p;
}
function write(root: string, file: string, value: unknown, dir = DIR): void {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  writeFileSync(join(scratch(root, dir), file), body, 'utf8');
}

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
    write(root, 'grounding.json', { references: [], terms: ['invoice'], sparse: true, path: 'rag' });
    write(root, 'label.json', {
      label: 'okay',
      signals: [{ kind: 'x', span: 'y' }],
      question_budget: 3,
    });
    write(root, 'questions.json', {
      questions: [],
      auto_answered: [{ question: 'q', answer: 'a', source: 'D-1' }],
      asked: 1,
      answered: 1,
      deferred: 0,
      tokens: 400,
    });
    write(root, 'task.json', { intent: 'x', tokens: 200 });
    write(root, 'trace.json', { entries: [], tokens: 900 });
    write(root, 'spec.md', SPEC);
    write(root, 'experts.json', { experts: [{ role: 'db-expert', reason: 'r' }] });
    write(root, 'expert-notes.json', {
      notes: [{ role: 'db-expert', findings: [] }],
      tokens: { 'db-expert': 1100 },
    });
    write(root, 'expert-synthesis.json', {
      verdict: 'ready',
      accepted: [],
      declined: [],
      conflicts: [],
      gaps: [],
      questions: [],
      tokens: 700,
    });

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

  it('degrades to neutral defaults for a bare run', () => {
    const root = tempRoot();
    scratch(root);
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
    expect(rows[0]!.changed_sections).toEqual(['acceptance_criteria']);
  });
});

describe('aggregateSpecPipelineMetrics + listRunDirs', () => {
  it('aggregates experts, tokens, conflicts, corrections and labels across runs (FR-11.4)', () => {
    const root = tempRoot();
    write(root, 'finish.json', {
      provenance: {
        experts: {
          accounting: {
            experts: [
              { role: 'db-expert', tokens: 1000, changed_spec: true },
              { role: 'security-auditor', tokens: 500, changed_spec: false },
            ],
          },
          conflicts: [{ target: 'x' }],
        },
        metrics: { label: 'okay', grounding_sparse: true, tokens_by_step: { craft: 900 } },
      },
    });
    write(root, 'expert-synthesis.json', {
      verdict: 'ready',
      accepted: [],
      declined: [],
      conflicts: [],
      gaps: [],
      questions: [],
      tokens: 0,
      auto_resolved: [{ target: 'x', chosen: 'c', source: 'D-1' }],
    });
    recordSpecCorrection(root, DIR, {
      spec_id: 'S-1',
      changed_sections: ['acceptance_criteria', 'invariants'],
      at: 'now',
    });

    expect(listRunDirs(root)).toEqual([DIR]);
    const report = aggregateSpecPipelineMetrics(root, listRunDirs(root));
    expect(report.runs).toBe(1);
    expect(report.experts_fired['db-expert']).toBe(1);
    expect(report.changed_spec_rate['db-expert']).toEqual({ fired: 1, changed: 1 });
    expect(report.changed_spec_rate['security-auditor']).toEqual({ fired: 1, changed: 0 });
    expect(report.tokens_by_role['db-expert']).toBe(1000);
    expect(report.tokens_by_step.craft).toBe(900);
    expect(report.conflicts).toBe(1);
    expect(report.auto_resolved).toBe(1);
    expect(report.corrections_by_section).toEqual({ acceptance_criteria: 1, invariants: 1 });
    expect(report.label_distribution).toEqual({ okay: 1 });
    expect(report.grounding_sparse_runs).toBe(1);
  });

  it('returns a zeroed report and empty run list for an empty store', () => {
    const root = tempRoot();
    expect(listRunDirs(root)).toEqual([]);
    const report = aggregateSpecPipelineMetrics(root, []);
    expect(report.runs).toBe(0);
    expect(report.conflicts).toBe(0);
  });
});
