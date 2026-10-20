import { describe, expect, it } from 'vitest';

import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';

describe('acceptance-criteria-gen ↔ freeze parser parity', () => {
  it('ingests flat AC-N criteria with their authored ids intact', () => {
    const markdown = [
      '## Acceptance criteria',
      '',
      '- AC-1: Given a user, when they sign in, then a session is created (proof: automated).',
      '- AC-2: Given a user, when they sign in with bad creds, then a 401 is returned (proof: manual).',
      '- AC-3: Given an admin, when they invite, then a 201 is returned (proof: automated).',
      '',
      '## Coverage Notes',
      '- AC-2 covers the permission edge.',
    ].join('\n');

    const spec = buildFeatureSpec({
      spec_id: 'S-parity',
      spec_file: '.paqad/_specs/S-parity.md',
      spec_markdown: markdown,
    });

    expect(spec.acceptance_criteria.map((c) => c.criterion_id)).toEqual(['AC-1', 'AC-2', 'AC-3']);
    expect(spec.acceptance_criteria).toHaveLength(3);
    expect(spec.acceptance_criteria[0]?.proof_type).toBe('automated');
    expect(spec.acceptance_criteria[1]?.proof_type).toBe('manual');
    expect(spec.acceptance_criteria[0]?.given).toBe('a user');
    expect(spec.acceptance_criteria[0]?.then).toContain('session is created');
  });
});
