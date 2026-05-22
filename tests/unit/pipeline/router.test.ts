import { describe, expect, it } from 'vitest';

import { PipelineRouter } from '@/pipeline/router.js';

import { fixtureClassification } from './shared.fixture.js';

describe('PipelineRouter', () => {
  const router = new PipelineRouter();

  it('routes full lane to correct phase sequence', () => {
    const result = router.route(fixtureClassification());

    expect(result.lane).toBe('full');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'sequence-planning',
      'specification',
      'user-flow',
      'spec-review',
      'implementation',
      'implementation-review',
      'verification-gates',
      'documentation-update',
    ]);
  });

  it('returns a null route when no workflow matched', () => {
    const result = router.route(
      fixtureClassification({
        workflow: null,
        workflow_source: 'none',
        workflow_reason: 'No workflow routing rule matched the incoming request.',
        matched_rule: null,
      }),
    );

    expect(result.lane).toBeNull();
    expect(result.phases).toEqual([]);
    expect(result.route_reason).toContain('No workflow routing rule matched');
  });

  it('routes graduated lane to reduced phase sequence', () => {
    const result = router.route(fixtureClassification({ complexity: 'medium', risk: 'medium' }));

    expect(result.lane).toBe('graduated');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'sequence-planning',
      'specification',
      'spec-review',
      'implementation',
      'implementation-review',
      'verification-gates',
      'documentation-update',
    ]);
  });

  it('routes fast lane to minimal phase sequence', () => {
    const result = router.route(
      fixtureClassification({ workflow: 'bug-fix', complexity: 'low', risk: 'low' }),
    );

    expect(result.lane).toBe('fast');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'implementation',
      'implementation-review',
      'verification-gates',
      'documentation-update',
    ]);
  });

  it('routes medium complexity + low risk to graduated lane', () => {
    const result = router.route(fixtureClassification({ complexity: 'medium', risk: 'low' }));
    expect(result.lane).toBe('graduated');
  });

  it('routes medium complexity + medium risk to graduated lane', () => {
    const result = router.route(fixtureClassification({ complexity: 'medium', risk: 'medium' }));
    expect(result.lane).toBe('graduated');
  });

  it('routes module-documentation workflow to the module-documentation phase sequence', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'module-documentation',
        output_type: 'documentation',
        complexity: 'medium',
        risk: 'low',
      }),
    );

    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'module-documentation',
    ]);
  });

  it('routes documentation requests to the documentation-only workflow phases', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'documentation-update',
        output_type: 'documentation',
        complexity: 'medium',
        risk: 'low',
        process_depth: 'graduated lane',
      }),
    );

    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'documentation-update',
    ]);
  });

  it('routes content writing workflows to the documentation-only phases', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'writing',
        target_capability: 'content',
        output_type: 'documentation',
        complexity: 'low',
        risk: 'low',
        process_depth: 'fast lane',
      }),
    );

    expect(result.lane).toBe('fast');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'documentation-update',
    ]);
  });

  it('routes content research workflows to the analysis-only phases', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'research',
        target_capability: 'content',
        output_type: 'analysis',
        complexity: 'medium',
        risk: 'low',
      }),
    );

    expect(result.lane).toBe('fast');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'question-answering',
    ]);
  });

  it('routes RCA requests to the RCA workflow phases', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'root-cause-analysis',
        output_type: 'report',
        complexity: 'medium',
        risk: 'low',
      }),
    );

    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'root-cause-analysis',
      'documentation-update',
    ]);
  });

  it('routes pentest requests to the pentest workflow phases', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'pentest',
        output_type: 'report',
        complexity: 'high',
        risk: 'medium',
      }),
    );

    expect(result.lane).toBe('graduated');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'pentest',
    ]);
  });

  it('routes pentest retest requests to the pentest-retest workflow phases', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'pentest-retest',
        output_type: 'report',
        complexity: 'high',
        risk: 'medium',
      }),
    );

    expect(result.lane).toBe('graduated');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'pentest-retest',
    ]);
  });

  it('routes custom workflows through the selected lane phases instead of an empty phase list', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'feature-with-review',
        workflow_reason: 'Matched workflow-router rule "feature with review".',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.lane).toBe('graduated');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'sequence-planning',
      'specification',
      'spec-review',
      'implementation',
      'implementation-review',
      'verification-gates',
      'documentation-update',
    ]);
  });

  it('routes project questions to the analysis-only workflow phases', () => {
    const result = router.route(
      fixtureClassification({
        request_text: 'How does the billing pipeline decide which workflow to run?',
        workflow: 'project-question',
        output_type: 'analysis',
        complexity: 'high',
        risk: 'high',
      }),
    );

    expect(result.lane).toBe('fast');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'question-answering',
    ]);
  });

  it('routes coding capability gaps through the analysis fallback instead of implementation', () => {
    const result = router.route(
      fixtureClassification({
        target_capability: 'coding',
        capability_gap: true,
        workflow: 'feature-development',
        output_type: 'code',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.lane).toBe('fast');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'question-answering',
    ]);
  });

  it('respects resume_lane when active implementation continuity overrides a question downgrade', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'feature-development',
        complexity: 'low',
        risk: 'low',
        capability_gap: true,
        resume_lane: 'full',
        workflow_continuity_reason:
          'Active implementation session remained open, so the follow-up stayed on the implementation lane.',
      }),
    );

    expect(result.lane).toBe('full');
    expect(result.route_reason).toContain('implementation lane');
    expect(result.phases).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'sequence-planning',
      'specification',
      'user-flow',
      'spec-review',
      'implementation',
      'implementation-review',
      'verification-gates',
      'documentation-update',
    ]);
  });

  it('does not demote a high-complexity capability-gap request to the fast lane', () => {
    const result = router.route(
      fixtureClassification({
        target_capability: 'coding',
        capability_gap: true,
        workflow: 'feature-development',
        output_type: 'code',
        complexity: 'high',
        risk: 'high',
      }),
    );

    // High complexity + high risk must still route through the full lane so spec / review phases run.
    expect(result.lane).toBe('full');
  });

  it('does not demote a high-risk capability-gap request to the fast lane', () => {
    const result = router.route(
      fixtureClassification({
        target_capability: 'coding',
        capability_gap: true,
        workflow: 'feature-development',
        output_type: 'code',
        complexity: 'medium',
        risk: 'high',
      }),
    );

    expect(result.lane).toBe('full');
  });

  it('routes medium complexity + high risk to full lane', () => {
    const result = router.route(fixtureClassification({ complexity: 'medium', risk: 'high' }));
    expect(result.lane).toBe('full');
  });

  it('routes low complexity + medium risk to graduated lane', () => {
    const result = router.route(fixtureClassification({ complexity: 'low', risk: 'medium' }));
    expect(result.lane).toBe('graduated');
  });

  it('routes investigations to the fast lane regardless of complexity', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'investigation',
        complexity: 'high',
        risk: 'high',
        process_depth: 'full lane',
      }),
    );

    expect(result.lane).toBe('fast');
  });

  it('routes migrations to the full lane regardless of complexity', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'migration',
        complexity: 'low',
        risk: 'low',
        process_depth: 'fast lane',
      }),
    );

    expect(result.lane).toBe('full');
  });

  it('routes high-risk bug fixes to graduated', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'bug-fix',
        complexity: 'high',
        risk: 'high',
      }),
    );

    expect(result.lane).toBe('graduated');
  });

  it('routes non-feature trivial work to fast through fallback rules', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'cleanup',
        complexity: 'trivial',
        risk: 'low',
        process_depth: 'fast lane',
      }),
    );

    expect(result.lane).toBe('fast');
  });

  it('routes low-complexity refactors with low risk to fast through fallback rules', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'refactor',
        complexity: 'low',
        risk: 'low',
        process_depth: 'fast lane',
      }),
    );

    expect(result.lane).toBe('fast');
  });

  it('routes low-complexity refactors with elevated risk to graduated through fallback rules', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'refactor',
        complexity: 'low',
        risk: 'medium',
      }),
    );

    expect(result.lane).toBe('graduated');
  });

  it('routes high-risk non-feature work to full through fallback rules', () => {
    const result = router.route(
      fixtureClassification({
        workflow: 'architecture-change',
        complexity: 'high',
        risk: 'high',
        process_depth: 'full lane',
      }),
    );

    expect(result.lane).toBe('full');
  });
});
