import { describe, expect, it } from 'vitest';

import {
  buildReviewDigest,
  DIGEST_LINE_CAP,
  type MachineFinding,
  type ReviewDigestInput,
} from '@/review-digest/index.js';

// Issue #360 — the composer is pure, so every section (including the honest degradations
// and the hard line cap) is provable from fixtures without touching a filesystem.
const EMPTY: ReviewDigestInput = {
  feature: null,
  generated_at: '2026-07-21T08:00:00.000Z',
  changed_files: [],
  stages: [],
  criteria: [],
  findings: [],
};

function finding(over: Partial<MachineFinding> = {}): MachineFinding {
  return {
    source: 'rule:RL-1',
    severity: 'high',
    tier: 'deterministic',
    file: 'src/x.ts',
    line: '12',
    message: 'a machine fact',
    ...over,
  };
}

describe('buildReviewDigest', () => {
  it('renders all four sections with honest "none recorded" lines when nothing exists (AC-1)', () => {
    const markdown = buildReviewDigest(EMPTY);

    expect(markdown).toContain('## Change');
    expect(markdown).toContain('## Spec');
    expect(markdown).toContain('## Machine findings');
    expect(markdown).toContain('## Blind spots');

    expect(markdown).toContain('- Feature: none active');
    expect(markdown).toContain('- Changed files: none recorded');
    expect(markdown).toContain('- Stages: none recorded');
    expect(markdown).toContain('No frozen acceptance criteria on record');
    expect(markdown).toContain('No machine findings recorded');
    // The blind spots are never "none" — they are the point of the section.
    expect(markdown).toContain('Semantic duplication');
  });

  it('renders the change header, spec and findings when every source has content (AC-1)', () => {
    const markdown = buildReviewDigest({
      ...EMPTY,
      feature: '360-review-digest-01JABCDEFGHJKMNPQRSTVWXYZ0',
      changed_files: ['src/a.ts', 'src/b.ts'],
      stages: [
        { stage: 'planning', state: 'complete' },
        { stage: 'review', state: 'running' },
      ],
      criteria: [
        {
          criterion_id: 'AC-1',
          given: 'a digest',
          when: 'it builds',
          then: 'it caps',
          proof_type: 'test',
        },
        { criterion_id: 'AC-2' },
      ],
      findings: [finding(), finding({ source: 'duplication', file: null, line: null })],
    });

    expect(markdown).toContain('- Feature: 360-review-digest-01JABCDEFGHJKMNPQRSTVWXYZ0');
    expect(markdown).toContain('- Changed files (2):');
    expect(markdown).toContain('  - src/a.ts');
    expect(markdown).toContain('- Stages: planning=complete · review=running');
    expect(markdown).toContain('- AC-1 [test] — given a digest, when it builds, then it caps');
    expect(markdown).toContain('- AC-2 — no given/when/then recorded');
    expect(markdown).toContain('rule:RL-1 | high | deterministic | src/x.ts:12 | a machine fact');
    // An anchor-less row still appears — it informs the reviewer, it just cannot be cited.
    expect(markdown).toContain('duplication | high | deterministic | - | a machine fact');
  });

  it('summarises the tail rather than listing every changed file', () => {
    const markdown = buildReviewDigest({
      ...EMPTY,
      changed_files: Array.from({ length: 20 }, (_, index) => `src/f${index}.ts`),
    });
    expect(markdown).toContain('- Changed files (20):');
    expect(markdown).toContain('  - src/f11.ts');
    expect(markdown).not.toContain('  - src/f12.ts');
    expect(markdown).toContain('  - …and 8 more');
  });

  it('caps the digest and says how much it dropped (AC-5)', () => {
    const markdown = buildReviewDigest({
      ...EMPTY,
      findings: Array.from({ length: 400 }, (_, index) =>
        finding({ file: `src/f${index}.ts`, line: String(index) }),
      ),
    });
    const lines = markdown.trimEnd().split('\n');

    expect(lines.length).toBe(DIGEST_LINE_CAP);
    expect(lines.at(-1)).toMatch(/^> …truncated: \d+ more lines \(cap 150\)\.$/);
  });

  it('leaves an at-cap digest untouched', () => {
    const markdown = buildReviewDigest(EMPTY);
    expect(markdown.trimEnd().split('\n').length).toBeLessThan(DIGEST_LINE_CAP);
    expect(markdown).not.toContain('truncated');
  });
});
