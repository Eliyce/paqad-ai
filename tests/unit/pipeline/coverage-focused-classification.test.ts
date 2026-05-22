import { describe, expect, it, vi } from 'vitest';

import { RequestClassifier } from '@/pipeline/classifier.js';
import { PostClassifier } from '@/pipeline/post-classifier.js';
import { PreClassifier } from '@/pipeline/pre-classifier.js';

function unresolvedPreResult() {
  return {
    resolved: {
      workflow: undefined,
      affected_modules: [],
      affected_modules_source: 'default',
      scope: undefined,
      scope_graph_depth: 0,
      database_impact: undefined,
      api_impact: undefined,
      ui_impact: undefined,
      compliance_sensitivity: undefined,
      customer_facing_impact: undefined,
      reversibility: undefined,
      data_sensitivity: undefined,
      delta_candidate: false,
      base_manifest_slug: null,
      prior_requirement_count: null,
      prior_criterion_count: null,
      context_budget_hint: 'minimal',
      matched_rule_triggers: [],
    },
    hints: {},
    unresolved: ['workflow'],
    resolution_map: {},
    evidence: [],
  };
}

describe('RequestClassifier fallback coverage', () => {
  it('covers content fallback and query-change inference', async () => {
    vi.spyOn(PreClassifier.prototype, 'classify').mockResolvedValue(unresolvedPreResult() as never);
    vi.spyOn(PostClassifier.prototype, 'adjust').mockResolvedValue({
      complexity: 'low',
      risk: 'low',
      lane_before_override: 'fast',
      lane_override_reason: null,
      risk_floor: null,
      risk_floor_reason: null,
      complexity_adjustment: 0,
      complexity_adjustment_reason: null,
      resolution_updates: {},
      high_override_rate: false,
    });

    const result = await new RequestClassifier().classify({
      request: 'content docs query index',
      resolved_workflow: { workflow: null, workflow_source: 'none' },
    });

    expect(result.target_capability).toBe('content');
    expect(result.stack).toBe('short-video');
    expect(result.database_impact).toBe('query-change');
    expect(result.output_type).toBe('analysis');
  });

  it('covers additive endpoint, new component, medium scope, and coding capability defaults', async () => {
    vi.spyOn(PreClassifier.prototype, 'classify').mockResolvedValue(unresolvedPreResult() as never);
    vi.spyOn(PostClassifier.prototype, 'adjust').mockResolvedValue({
      complexity: 'medium',
      risk: 'medium',
      lane_before_override: 'graduated',
      lane_override_reason: null,
      risk_floor: null,
      risk_floor_reason: null,
      complexity_adjustment: 0,
      complexity_adjustment_reason: null,
      resolution_updates: {},
      high_override_rate: false,
    });

    const result = await new RequestClassifier().classify({
      request: 'api route component add',
      profile: {
        active_capabilities: ['content'],
        routing: { domain: 'coding', stack: 'flutter', capabilities: [] },
        stack_profile: {
          frameworks: ['flutter'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: { workflow: 'feature-development', workflow_source: 'routing-skill' },
    });

    expect(result.capability_gap).toBe(true);
    expect(result.api_impact).toBe('additive-endpoint');
    expect(result.ui_impact).toBe('new-component');
    expect(result.scope).toBe('multi-module');
    expect(result.affected_modules).toContain('lib/services');
    expect(result.affected_modules).toContain('lib/widgets');
  });

  it('covers workflow-specific output types and stack-specific module prefixes', async () => {
    vi.spyOn(PreClassifier.prototype, 'classify').mockResolvedValue(unresolvedPreResult() as never);
    vi.spyOn(PostClassifier.prototype, 'adjust').mockResolvedValue({
      complexity: 'high',
      risk: 'high',
      lane_before_override: 'full',
      lane_override_reason: null,
      risk_floor: null,
      risk_floor_reason: null,
      complexity_adjustment: 0,
      complexity_adjustment_reason: null,
      resolution_updates: {},
      high_override_rate: false,
    });

    const pentest = await new RequestClassifier().classify({
      request: 'security issue',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['django'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: { workflow: 'pentest-retest', workflow_source: 'routing-skill' },
    });

    const doc = await new RequestClassifier().classify({
      request: 'write docs',
      resolved_workflow: { workflow: 'writing', workflow_source: 'routing-skill' },
    });

    const code = await new RequestClassifier().classify({
      request: 'api page component migration',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['django'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: { workflow: 'bug-fix', workflow_source: 'routing-skill' },
    });

    expect(pentest.output_type).toBe('report');
    expect(doc.output_type).toBe('documentation');
    expect(code.affected_modules).toContain('app/api');
    expect(code.affected_modules).toContain('app/routes');
  });

  it('covers trivial fallback and laravel screen/component prefixes', async () => {
    vi.spyOn(PreClassifier.prototype, 'classify').mockResolvedValue(unresolvedPreResult() as never);
    vi.spyOn(PostClassifier.prototype, 'adjust').mockResolvedValue({
      complexity: 'trivial',
      risk: 'low',
      lane_before_override: 'fast',
      lane_override_reason: null,
      risk_floor: null,
      risk_floor_reason: null,
      complexity_adjustment: 0,
      complexity_adjustment_reason: null,
      resolution_updates: {},
      high_override_rate: false,
    });

    const result = await new RequestClassifier().classify({
      request: 'small cleanup file typo page component',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['laravel'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: { workflow: 'cleanup', workflow_source: 'routing-skill' },
    });

    expect(result.scope).toBe('single-file');
    expect(result.affected_modules).toContain('resources/views');
    expect(result.affected_modules).toContain('resources/js/pages');
  });

  it('covers fallback branches for difficult reversibility, sensitivity, explicit modules, and system-wide docs scope', async () => {
    vi.spyOn(PreClassifier.prototype, 'classify').mockResolvedValue(unresolvedPreResult() as never);
    vi.spyOn(PostClassifier.prototype, 'adjust').mockResolvedValue({
      complexity: 'high',
      risk: 'high',
      lane_before_override: 'full',
      lane_override_reason: null,
      risk_floor: null,
      risk_floor_reason: null,
      complexity_adjustment: 0,
      complexity_adjustment_reason: null,
      resolution_updates: {},
      high_override_rate: false,
    });

    const migration = await new RequestClassifier().classify({
      request: 'data migration for payment data in src/payments/ledger.ts',
      resolved_workflow: { workflow: 'feature-development', workflow_source: 'routing-skill' },
    });
    const docs = await new RequestClassifier().classify({
      request: 'update docs for system architecture',
      resolved_workflow: { workflow: 'documentation-update', workflow_source: 'routing-skill' },
    });
    const breakingApi = await new RequestClassifier().classify({
      request: 'breaking api redesign with pii',
      resolved_workflow: { workflow: 'feature-development', workflow_source: 'routing-skill' },
    });

    expect(migration.database_impact).toBe('data-migration');
    expect(migration.reversibility).toBe('difficult');
    expect(migration.data_sensitivity).toBe('financial');
    expect(migration.affected_modules).toEqual(['src/payments/ledger']);
    expect(docs.scope).toBe('system-wide');
    expect(breakingApi.api_impact).toBe('breaking-change');
    expect(breakingApi.ui_impact).toBe('redesign');
    expect(breakingApi.data_sensitivity).toBe('pii');
  });

  it('covers modified endpoints and default stack prefixes', async () => {
    vi.spyOn(PreClassifier.prototype, 'classify').mockResolvedValue(unresolvedPreResult() as never);
    vi.spyOn(PostClassifier.prototype, 'adjust').mockResolvedValue({
      complexity: 'medium',
      risk: 'medium',
      lane_before_override: 'graduated',
      lane_override_reason: null,
      risk_floor: null,
      risk_floor_reason: null,
      complexity_adjustment: 0,
      complexity_adjustment_reason: null,
      resolution_updates: {},
      high_override_rate: false,
    });

    const modifiedEndpoint = await new RequestClassifier().classify({
      request: 'update api route',
      resolved_workflow: { workflow: 'bug-fix', workflow_source: 'routing-skill' },
    });
    const defaultFramework = await new RequestClassifier().classify({
      request: 'api route',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['rails'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: { workflow: 'feature-development', workflow_source: 'routing-skill' },
    });
    const defaultScreens = await new RequestClassifier().classify({
      request: 'screen',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['rails'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: { workflow: 'feature-development', workflow_source: 'routing-skill' },
    });

    expect(modifiedEndpoint.api_impact).toBe('modified-endpoint');
    expect(defaultFramework.affected_modules).toContain('src/api');
    expect(defaultFramework.affected_modules).toContain('src/server');
    expect(defaultScreens.affected_modules).toContain('src/pages');
    expect(defaultScreens.affected_modules).toContain('src/screens');
  });

  it('covers trivial explicit-file detection and flutter screen prefixes', async () => {
    vi.spyOn(PreClassifier.prototype, 'classify').mockResolvedValue(unresolvedPreResult() as never);
    vi.spyOn(PostClassifier.prototype, 'adjust').mockResolvedValue({
      complexity: 'trivial',
      risk: 'low',
      lane_before_override: 'fast',
      lane_override_reason: null,
      risk_floor: null,
      risk_floor_reason: null,
      complexity_adjustment: 0,
      complexity_adjustment_reason: null,
      resolution_updates: {},
      high_override_rate: false,
    });

    const explicitTrivial = await new RequestClassifier().classify({
      request: 'small cleanup src/ui/button.ts',
      resolved_workflow: { workflow: 'cleanup', workflow_source: 'routing-skill' },
    });
    const flutterScreen = await new RequestClassifier().classify({
      request: 'screen',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['flutter'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: { workflow: 'feature-development', workflow_source: 'routing-skill' },
    });

    expect(explicitTrivial.scope).toBe('single-file');
    expect(explicitTrivial.affected_modules).toEqual(['src/ui/button']);
    expect(flutterScreen.affected_modules).toEqual(['lib/screens']);
  });

  it('covers capability-gap defaults, gdpr sensitivity, and default workflow source', async () => {
    vi.spyOn(PreClassifier.prototype, 'classify').mockResolvedValue(unresolvedPreResult() as never);
    vi.spyOn(PostClassifier.prototype, 'adjust').mockResolvedValue({
      complexity: 'low',
      risk: 'low',
      lane_before_override: 'fast',
      lane_override_reason: null,
      risk_floor: null,
      risk_floor_reason: null,
      complexity_adjustment: 0,
      complexity_adjustment_reason: null,
      resolution_updates: {},
      high_override_rate: false,
    });

    const result = await new RequestClassifier().classify({
      request: 'security gdpr',
      profile: {
        routing: { domain: 'content', stack: 'short-video', capabilities: [] },
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
    });

    expect(result.target_capability).toBe('security');
    expect(result.capability_gap).toBe(true);
    expect(result.compliance_sensitivity).toBe('high');
    expect(result.workflow_source).toBe('none');
  });

  it('covers default active capability inference for coding-domain routing', async () => {
    vi.spyOn(PreClassifier.prototype, 'classify').mockResolvedValue(unresolvedPreResult() as never);
    vi.spyOn(PostClassifier.prototype, 'adjust').mockResolvedValue({
      complexity: 'low',
      risk: 'low',
      lane_before_override: 'fast',
      lane_override_reason: null,
      risk_floor: null,
      risk_floor_reason: null,
      complexity_adjustment: 0,
      complexity_adjustment_reason: null,
      resolution_updates: {},
      high_override_rate: false,
    });

    const result = await new RequestClassifier().classify({
      request: 'implement endpoint',
      profile: {
        routing: { domain: 'coding', stack: 'react', capabilities: [] },
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: { workflow: 'feature-development', workflow_source: 'routing-skill' },
    });

    expect(result.capability_gap).toBe(false);
  });
});
