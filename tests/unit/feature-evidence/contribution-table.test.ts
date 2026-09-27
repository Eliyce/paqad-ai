import { describe, expect, it } from 'vitest';

import type { AcceptedFinding } from '@/core/types/feature-spec.js';
import {
  renderContributionTable,
  roleInPlainWords,
  type ContributionTraceEntry,
} from '@/feature-evidence/contribution-table.js';

const findings: AcceptedFinding[] = [
  {
    id: 'EX-solution-architect-2',
    role: 'solution-architect',
    kind: 'requirement',
    severity: 'must',
    target: 'rules-loaded.json',
    claim: 'rules-loaded.json must be an `optional` manifest row, checked-when-present',
  },
  {
    id: 'EX-qa-engineer-1',
    role: 'qa-engineer',
    kind: 'acceptance',
    severity: 'must',
    target: 'rules load',
    claim:
      '`paqad-ai rules load` writes rules-loaded.json with applicable rule ids and matched paths',
  },
];

const trace: ContributionTraceEntry[] = [
  { id: 'FR-1', source: 'task' },
  { id: 'FR-2', source: 'EX-solution-architect-2' },
  { id: 'AC-1', source: 'EX-qa-engineer-1' },
  { id: 'AC-4', source: 'D-01ABC' },
];

describe('roleInPlainWords', () => {
  it('renders role ids in plain words with acronyms preserved', () => {
    expect(roleInPlainWords('application-architect')).toBe('Application architect');
    expect(roleInPlainWords('qa-engineer')).toBe('QA engineer');
    expect(roleInPlainWords('solution-architect')).toBe('Solution architect');
  });
});

describe('renderContributionTable (issue #558, FR-13.2)', () => {
  it('joins trace to findings by id, one row per expert-sourced line', () => {
    const table = renderContributionTable(trace, findings);
    expect(table).toContain('## Who contributed what');
    expect(table).toContain('| Line | From | What the expert said |');
    expect(table).toContain(
      '| FR-2 | Solution architect | rules-loaded.json must be an `optional` manifest row, checked-when-present |',
    );
    expect(table).toContain(
      '| AC-1 | QA engineer | `paqad-ai rules load` writes rules-loaded.json with applicable rule ids and matched paths |',
    );
  });

  it('lists request and answer lines below the table', () => {
    const table = renderContributionTable(trace, findings);
    expect(table).toContain('FR-1: from the request.');
    expect(table).toContain('AC-4: from your answer (D-01ABC).');
  });

  it('renders nothing when no spec line traces to an expert finding (off = no section)', () => {
    expect(renderContributionTable([{ id: 'FR-1', source: 'task' }], findings)).toBe('');
    expect(renderContributionTable([], [])).toBe('');
  });

  it('is deterministic across 50 runs (FR-13.3)', () => {
    const first = renderContributionTable(trace, findings);
    for (let i = 0; i < 50; i += 1) {
      expect(renderContributionTable(trace, findings)).toBe(first);
    }
  });
});
