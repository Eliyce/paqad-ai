import { describe, expect, it } from 'vitest';

import { renderSpecMarkdown } from '@/feature-evidence/spec-markdown.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

/** A full frozen spec exercising every renderable section. */
function fullSpec(): FeatureSpec {
  return {
    schema_version: '1',
    spec_id: 'S-512-example',
    spec_file: '.paqad/_specs/S-512.md',
    spec_hash: 'b'.repeat(64),
    behaviour: ['FR-1: writes a readable spec', 'FR-2: pairs the two files'],
    acceptance_criteria: [
      {
        criterion_id: 'AC-1',
        given: 'a frozen spec',
        when: 'it is rendered',
        then: 'markdown is produced',
        proof_type: 'automated',
        status: 'uncovered',
        source: 'planned',
        linked_requirement_ids: ['FR-1'],
      },
    ],
    invariants: [
      { invariant_id: 'INV-1', statement: 'derived only', source: 'authored', confirmed: true },
      { invariant_id: 'INV-2', statement: 'no IO', source: 'authored', confirmed: false },
    ],
    open_questions: [],
    frozen: {
      frozen_at: '2026-09-04T00:00:00.000Z',
      spec_hash: 'b'.repeat(64),
      signed_off_by: 'haider',
    },
    spec_review: {
      reviewed_at: '2026-09-04T00:00:00.000Z',
      defect_count: 2,
      by_severity: { critical: 0, major: 1, minor: 1 },
    },
    non_goals: ['does not touch the freeze parser'],
  };
}

describe('renderSpecMarkdown', () => {
  it('renders every section from a full spec', () => {
    const md = renderSpecMarkdown(fullSpec());
    expect(md).toContain('# Specification: S-512-example');
    expect(md).toContain('## Frozen');
    expect(md).toContain('Signed off by: haider');
    expect(md).toContain('Spec hash: ' + 'b'.repeat(64));
    expect(md).toContain('Spec file: .paqad/_specs/S-512.md');
    expect(md).toContain('## Behaviour');
    expect(md).toContain('- FR-1: writes a readable spec');
    expect(md).toContain('## Acceptance criteria');
    expect(md).toContain(
      '**AC-1**: Given a frozen spec, when it is rendered, then markdown is produced (proof: automated)',
    );
    expect(md).toContain('## Invariants');
    expect(md).toContain('**INV-1**: derived only _(source: authored, confirmed: ✓)_');
    expect(md).toContain('**INV-2**: no IO _(source: authored, confirmed: ✗)_');
    expect(md).toContain('## Spec review');
    expect(md).toContain('Open defects: 2');
    expect(md).toContain('critical 0, major 1, minor 1');
    expect(md).toContain('## Non-goals');
    expect(md).toContain('- does not touch the freeze parser');
    expect(md).toContain('generated, read-only projection');
  });

  it('omits the Spec review section when absent (pre-#401 records)', () => {
    const spec = fullSpec();
    delete spec.spec_review;
    const md = renderSpecMarkdown(spec);
    expect(md).not.toContain('## Spec review');
  });

  it('omits the Non-goals section when absent or empty', () => {
    const spec = fullSpec();
    delete spec.non_goals;
    expect(renderSpecMarkdown(spec)).not.toContain('## Non-goals');
    expect(renderSpecMarkdown({ ...fullSpec(), non_goals: [] })).not.toContain('## Non-goals');
  });

  it('renders a criterion with only a then-clause plainly', () => {
    const spec = fullSpec();
    spec.acceptance_criteria = [
      {
        criterion_id: 'AC-2',
        given: '',
        when: '',
        then: 'the thing happens',
        proof_type: 'manual',
        status: 'uncovered',
        source: 'planned',
        linked_requirement_ids: [],
      },
    ];
    expect(renderSpecMarkdown(spec)).toContain('**AC-2**: the thing happens (proof: manual)');
  });

  it('renders placeholders when behaviour / criteria / invariants are empty', () => {
    const spec: FeatureSpec = {
      ...fullSpec(),
      behaviour: [],
      acceptance_criteria: [],
      invariants: [],
    };
    const md = renderSpecMarkdown(spec);
    expect(md.match(/_None recorded._/g)?.length).toBe(3);
  });

  it('throws on an unfrozen spec', () => {
    expect(() => renderSpecMarkdown({ ...fullSpec(), frozen: null })).toThrow(/unfrozen/);
  });

  it('is deterministic — same spec renders byte-identical markdown', () => {
    const spec = fullSpec();
    expect(renderSpecMarkdown(spec)).toBe(renderSpecMarkdown(spec));
    expect(renderSpecMarkdown(fullSpec())).toBe(renderSpecMarkdown(fullSpec()));
  });
});

// Issue #547 — the ## Provenance section renders only when the field is present (FR-9.4 / AC-11).
describe('renderSpecMarkdown provenance', () => {
  function frozenBase(): FeatureSpec {
    return {
      schema_version: '1',
      spec_id: 'S-547',
      spec_file: 'spec.md',
      spec_hash: 'c'.repeat(64),
      behaviour: ['FR-1: x'],
      acceptance_criteria: [],
      invariants: [],
      open_questions: [],
      frozen: { frozen_at: '2026-09-10T00:00:00.000Z', spec_hash: 'c'.repeat(64), signed_off_by: 'h' },
    };
  }

  it('omits ## Provenance when the field is absent (byte-identical to a pre-#547 record)', () => {
    expect(renderSpecMarkdown(frozenBase())).not.toContain('## Provenance');
  });

  it('renders a full pipeline provenance block', () => {
    const md = renderSpecMarkdown({
      ...frozenBase(),
      provenance: {
        pipeline_produced: true,
        label: 'okay',
        grounding: { sparse: true, path: 'rag' },
        questions: { asked: 2, answered: 2, auto_answered: 1, deferred: 0 },
        experts: { roles: ['db-expert', 'security-auditor'], accepted: 3, declined: 1, conflicts: 2, auto_resolved: 1 },
      },
    });
    expect(md).toContain('## Provenance');
    expect(md).toContain('- Pipeline-produced: yes');
    expect(md).toContain('- Clarity label: okay');
    expect(md).toContain('- Grounding: rag (sparse)');
    expect(md).toContain('- Questions: asked 2, answered 2, auto-answered 1, deferred 0');
    expect(md).toContain('- Experts: db-expert, security-auditor (accepted 3, declined 1)');
    expect(md).toContain('- Conflicts: 2 (auto-resolved 1)');
  });

  it('renders a manual-reason provenance block', () => {
    const md = renderSpecMarkdown({
      ...frozenBase(),
      provenance: { pipeline_produced: false, manual_reason: 'urgent hotfix' },
    });
    expect(md).toContain('- Pipeline-produced: no');
    expect(md).toContain('- Manual reason: urgent hotfix');
  });
});
