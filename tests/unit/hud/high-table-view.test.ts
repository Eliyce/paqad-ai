import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { buildHighTableView } from '@/hud/high-table-view.js';

const DIR = '7-high-table-01KXD47JQ2AKEF8C3KCMA977NB';

describe('buildHighTableView with sparse expert records', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-high-table-view-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeBundle(file: 'experts' | 'clarification', value: unknown): void {
    const path = join(root, featureFilePath(DIR, file));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  }

  it('fills empty strings for synthesis entries that carry no fields', () => {
    writeBundle('experts', {
      roster: [{ role: 'qa-engineer' }, {}],
      findings: [{ role: 'qa-engineer' }, { role: 'qa-engineer' }, {}],
      synthesis: {
        accepted: ['EX-qa-engineer-1', 7],
        declined: [{}],
        conflicts: [{}],
        renames: [{}],
        auto_resolved: [{}],
        gaps: [{}, { area: 'auth', why_it_matters: 'tokens', question: { business_text: 'Who?' } }],
      },
    });
    writeBundle('clarification', { questions: { asked: ['a', 'b'], auto_answered: [{}] } });

    const view = buildHighTableView(root, DIR, { frozen: { frozen_at: 'not-a-date' } }, 'full');

    expect(view?.seats.map((seat) => [seat.role, seat.findings])).toEqual([
      ['qa-engineer', 2],
      ['unknown', 0],
    ]);
    expect(view?.rulings).toEqual({
      accepted: ['EX-qa-engineer-1'],
      declined: [{ id: '', reason: '' }],
      conflicts: [{ target: '', recommendation: '', rationale: '' }],
      renames: [{ id: '', target: '' }],
      settled: [{ target: '', chosen: '', source: '' }],
    });
    expect(view?.gaps).toEqual([
      { area: '', why_it_matters: '', question: null },
      { area: 'auth', why_it_matters: 'tokens', question: 'Who?' },
    ]);
    expect(view?.questions).toEqual({ asked: 2, auto_answered: [{ question: '', source: '' }] });
    expect(view?.chief?.state).toBe('done');
  });

  it('reads no rulings and a zero question count when the records are missing', () => {
    writeBundle('experts', { roster: [{ role: 'db-expert' }], synthesis: { accepted: 'none' } });
    writeBundle('clarification', { questions: {} });

    const view = buildHighTableView(root, DIR, { trace: { 'FR-1': 42 } }, null);

    expect(view?.rulings?.accepted).toEqual([]);
    expect(view?.questions).toEqual({ asked: 0, auto_answered: [] });
    expect(view?.credits).toEqual([]);
    expect(view?.seats[0]?.findings).toBeNull();
  });
});
