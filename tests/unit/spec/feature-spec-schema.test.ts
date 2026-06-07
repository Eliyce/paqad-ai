import { describe, expect, it } from 'vitest';

import { SchemaValidator } from '@/validators/validator.js';
import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';

const VALID_SPEC = {
  schema_version: '1',
  spec_id: 'S-102',
  spec_file: '.paqad/specs/S-102.md',
  spec_hash: 'abc123',
  behaviour: ['FR-1: does a thing'],
  acceptance_criteria: [
    {
      criterion_id: 'AC-1',
      given: 'a',
      when: 'b',
      then: 'c',
      proof_type: 'automated',
      status: 'uncovered',
      source: 'planned',
      linked_requirement_ids: ['FR-1'],
    },
  ],
  invariants: [
    { invariant_id: 'INV-1', statement: 'never break', source: 'authored', confirmed: false },
  ],
  open_questions: [],
  frozen: null,
};

describe('feature-spec schema', () => {
  const validator = new SchemaValidator();

  it('accepts a well-formed feature spec', () => {
    expect(validator.validate('feature-spec', VALID_SPEC).valid).toBe(true);
  });

  it('rejects unknown keys (additionalProperties: false)', () => {
    expect(validator.validate('feature-spec', { ...VALID_SPEC, typo: true }).valid).toBe(false);
  });

  it('rejects a criterion id that is not AC-n', () => {
    const bad = {
      ...VALID_SPEC,
      acceptance_criteria: [{ ...VALID_SPEC.acceptance_criteria[0], criterion_id: 'AC-1.2' }],
    };
    expect(validator.validate('feature-spec', bad).valid).toBe(false);
  });

  it('accepts a frozen feature spec', () => {
    const frozen = {
      ...VALID_SPEC,
      frozen: {
        frozen_at: '2026-06-07T12:00:00Z',
        spec_hash: 'abc123',
        signed_off_by: 'haider',
      },
    };
    expect(validator.validate('feature-spec', frozen).valid).toBe(true);
  });

  it('validates a spec produced by the builder', () => {
    const spec = buildFeatureSpec({
      spec_id: 'S-200',
      spec_file: '.paqad/specs/S-200.md',
      spec_markdown:
        '## Functional Requirements\nFR-1: do it.\n\n## Acceptance Criteria\nAC-1: Given a, when b, then c.\n\n## Invariants\n- INV-1: never break.\n',
    });
    expect(validator.validate('feature-spec', spec).valid).toBe(true);
  });
});
