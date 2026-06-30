import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { queryPatterns } from '@/compliance/defect-patterns/store.js';
import { computeClassificationConfidence } from '@/pipeline/confidence-scorer.js';
import { detectDeltaCandidate } from '@/pipeline/delta-detector.js';
import { resolveImpacts } from '@/pipeline/impact-resolver.js';
import { shouldSkipLlm } from '@/pipeline/llm-skip-evaluator.js';
import { ModuleResolver } from '@/pipeline/module-resolver.js';
import { PostClassifier } from '@/pipeline/post-classifier.js';
import { PreClassifier } from '@/pipeline/pre-classifier.js';
import { matchRuleTriggers } from '@/pipeline/rule-trigger-matcher.js';
import * as ruleTriggerMatcher from '@/pipeline/rule-trigger-matcher.js';
import { resolveScope } from '@/pipeline/scope-resolver.js';
import { ChunkIndexManager } from '@/context/chunk-index.js';
import { RagService } from '@/rag/service.js';
import { readAllModuleHealth } from '@/planning/module-health.js';

vi.mock('@/compliance/defect-patterns/store.js', async () => {
  const actual = await vi.importActual<typeof import('@/compliance/defect-patterns/store.js')>(
    '@/compliance/defect-patterns/store.js',
  );
  return { ...actual, queryPatterns: vi.fn() };
});

describe('pipeline helper coverage', () => {
  it('covers remaining helper branches', async () => {
    expect(computeClassificationConfidence({ workflow: undefined })).toBe(0);
    // Unknown source falls back to weight 0.1; 0.1 / 15 ≈ 0.01
    expect(
      computeClassificationConfidence({
        workflow: 'custom-source' as never,
      }),
    ).toBe(0.01);

    const deltaRoot = mkdtempSync(join(tmpdir(), 'paqad-delta-extra-'));
    mkdirSync(join(deltaRoot, '.paqad/specs'), { recursive: true });
    writeFileSync(
      join(deltaRoot, '.paqad/specs/empty.yaml'),
      [
        'plan_version: 1',
        'plan_mode: full',
        'feature_id: empty',
        'slug: empty',
        'created_at: 2026-04-10T00:00:00.000Z',
        'base_manifest_hash: null',
        'classification:',
        '  workflow: feature-development',
        '  complexity: low',
        '  risk: low',
        '  lane: graduated',
        '  domain: coding',
        '  stack: react',
        '  affected_modules: []',
        'requirement_graph: []',
        'execution_slices: []',
        'verification_matrix: []',
        'decision_log: []',
        'doc_targets: []',
        'regression_watch: []',
      ].join('\n'),
    );
    await expect(detectDeltaCandidate(deltaRoot, ['src/a'])).resolves.toEqual({
      delta_candidate: false,
      base_manifest_slug: null,
      prior_requirement_count: null,
      prior_criterion_count: null,
    });
    writeFileSync(
      join(deltaRoot, '.paqad/specs/missing-affected.yaml'),
      [
        'plan_version: 1',
        'plan_mode: full',
        'feature_id: missing-affected',
        'slug: missing-affected',
        'created_at: 2026-04-10T00:00:00.000Z',
        'base_manifest_hash: null',
        'classification:',
        '  workflow: feature-development',
        '  complexity: low',
        '  risk: low',
        '  lane: graduated',
        '  domain: coding',
        '  stack: react',
        'requirement_graph: []',
        'execution_slices: []',
        'verification_matrix: []',
        'decision_log: []',
        'doc_targets: []',
        'regression_watch: []',
      ].join('\n'),
    );
    await expect(detectDeltaCandidate(deltaRoot, ['src/a'])).resolves.toEqual({
      delta_candidate: false,
      base_manifest_slug: null,
      prior_requirement_count: null,
      prior_criterion_count: null,
    });

    expect(
      resolveImpacts({
        requestText: 'health endpoint',
        modulePaths: [],
      }).data_sensitivity,
    ).toBe('health');
    expect(
      resolveImpacts({
        requestText: 'query index payment',
        modulePaths: [],
      }),
    ).toMatchObject({
      database_impact: 'query-change',
      data_sensitivity: 'financial',
    });
    expect(
      resolveImpacts({
        requestText: 'update route page',
        modulePaths: [],
      }),
    ).toMatchObject({
      api_impact: 'modified-endpoint',
      ui_impact: 'new-screen',
    });
    expect(
      resolveImpacts({
        requestText: 'button',
        modulePaths: [],
      }).ui_impact,
    ).toBe('new-component');
    expect(
      resolveImpacts({
        requestText: 'table update',
        modulePaths: [],
      }).database_impact,
    ).toBe('schema-change');

    expect(
      shouldSkipLlm(
        {
          resolved: {
            workflow: null,
            affected_modules_source: 'rag',
            matched_rule_triggers: [],
            delta_candidate: false,
          },
          hints: {},
          unresolved: [],
          resolution_map: {},
          evidence: [],
        } as never,
        0.95,
        'cleanup',
        {
          workflow: 'deterministic',
          scope: 'deterministic:graph',
          database_impact: 'deterministic',
          api_impact: 'deterministic',
          ui_impact: 'deterministic',
        },
      ),
    ).toBe(false);
    expect(
      shouldSkipLlm(
        {
          resolved: {
            workflow: 'cleanup',
            affected_modules_source: 'explicit-path',
            matched_rule_triggers: [],
            delta_candidate: false,
          },
          hints: {},
          unresolved: [],
          resolution_map: {},
          evidence: [],
        } as never,
        0.95,
        'cleanup request',
        {
          workflow: 'deterministic',
          scope: 'deterministic:graph',
          database_impact: 'deterministic',
          api_impact: 'deterministic',
        } as never,
      ),
    ).toBe(false);
    expect(
      shouldSkipLlm(
        {
          resolved: {
            workflow: 'cleanup',
            affected_modules_source: undefined,
            matched_rule_triggers: undefined,
            delta_candidate: false,
          },
          hints: {},
          unresolved: [],
          resolution_map: {},
          evidence: [],
        } as never,
        0.95,
        'cleanup request',
        {
          workflow: 'deterministic',
          scope: 'deterministic:graph',
          database_impact: 'deterministic',
          api_impact: 'deterministic',
          ui_impact: 'deterministic',
        } as never,
      ),
    ).toBe(false);
    expect(
      shouldSkipLlm(
        {
          resolved: {
            workflow: 'cleanup',
            affected_modules_source: 'default',
            matched_rule_triggers: [],
            delta_candidate: false,
          },
          hints: {},
          unresolved: [],
          resolution_map: {},
          evidence: [],
        } as never,
        0.95,
        'cleanup request',
        {
          workflow: 'deterministic',
          scope: 'deterministic:graph',
          database_impact: 'deterministic',
          api_impact: 'deterministic',
          ui_impact: 'deterministic',
        } as never,
      ),
    ).toBe(false);

    const moduleRoot = mkdtempSync(join(tmpdir(), 'paqad-module-extra-'));
    vi.spyOn(ChunkIndexManager.prototype, 'load').mockResolvedValue({
      version: 1,
      generated_at: new Date().toISOString(),
      entries: [],
    });
    vi.spyOn(RagService.prototype, 'retrieveForEval').mockRejectedValue(new Error('boom'));
    const flutterResolver = new ModuleResolver(moduleRoot, {
      stack_profile: {
        frameworks: ['flutter'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
      intelligence: { rag_enabled: true },
    });
    const flutterModules = await flutterResolver.resolve('api page component');
    expect(flutterModules.modules.map((entry) => entry.path)).toEqual([
      'lib/services',
      'lib/screens',
      'lib/widgets',
    ]);

    const noMatchResolver = new ModuleResolver(moduleRoot, {
      stack_profile: {
        frameworks: ['react'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });
    const noMatch = await noMatchResolver.resolve('Update src/missing/file');
    expect(noMatch.modules).toEqual([]);

    const basenameRoot = mkdtempSync(join(tmpdir(), 'paqad-module-basenames-'));
    mkdirSync(join(basenameRoot, 'src/path'), { recursive: true });
    writeFileSync(join(basenameRoot, 'src/path/known.ts'), 'export const known = true;\n');
    const basenameResolver = new ModuleResolver(basenameRoot, {
      stack_profile: {
        frameworks: ['laravel'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });
    const basenameMiss = await basenameResolver.resolve('touch src/path/unknown.ts');
    expect(basenameMiss.modules).toEqual([]);

    vi.spyOn(ChunkIndexManager.prototype, 'load').mockResolvedValueOnce(null);
    const missingIndexResolver = new ModuleResolver(basenameRoot, {
      stack_profile: {
        frameworks: ['react'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });
    const missingIndex = await missingIndexResolver.resolve('Fix AuthService');
    expect(missingIndex.modules).toEqual([]);

    const laravelComponentResolver = new ModuleResolver(moduleRoot, {
      stack_profile: {
        frameworks: ['laravel'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });
    const laravelComponents = await laravelComponentResolver.resolve('build component');
    expect(laravelComponents.modules.map((entry) => entry.path)).toEqual([
      'resources/js/components',
      'app/View/Components',
    ]);

    const postRoot = mkdtempSync(join(tmpdir(), 'paqad-post-extra-'));
    mkdirSync(join(postRoot, '.paqad/specs'), { recursive: true });
    writeFileSync(
      join(postRoot, '.paqad/specs/over.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 250, unplanned_files: ['src/x'] }),
    );
    writeFileSync(
      join(postRoot, '.paqad/specs/over2.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 230, unplanned_files: ['src/x'] }),
    );
    writeFileSync(
      join(postRoot, '.paqad/specs/over3.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 220, unplanned_files: ['src/x'] }),
    );
    vi.mocked(queryPatterns).mockRejectedValueOnce(new Error('no-store'));
    const overAdjusted = await new PostClassifier(postRoot).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'migration',
        workflow_source: 'routing-skill',
        complexity: 'medium',
        risk: 'low',
        scope: 'single-file',
        affected_modules: ['src/x'],
        process_depth: 'graduated lane',
        certainty: 'well-defined',
        output_type: 'code',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
      {} as never,
      {} as never,
    );
    expect(overAdjusted.complexity_adjustment).toBe(-1);
    expect(overAdjusted.lane_before_override).toBe('full');

    const mediumRiskRoot = mkdtempSync(join(tmpdir(), 'paqad-post-medium-'));
    mkdirSync(join(mediumRiskRoot, '.paqad/specs'), { recursive: true });
    mkdirSync(join(mediumRiskRoot, '.paqad/cache'), { recursive: true });
    writeFileSync(join(mediumRiskRoot, '.paqad/specs/a.plan-vs-actual.json'), '{bad');
    writeFileSync(
      join(mediumRiskRoot, '.paqad/specs/b.plan-vs-actual.json'),
      JSON.stringify({ unplanned_files: null }),
    );
    writeFileSync(
      join(mediumRiskRoot, '.paqad/specs/c.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 100, unplanned_files: ['src/other'] }),
    );
    writeFileSync(
      join(mediumRiskRoot, '.paqad/specs/d.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 101, unplanned_files: ['src/medium'] }),
    );
    writeFileSync(
      join(mediumRiskRoot, '.paqad/specs/e.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 101, unplanned_files: ['src/medium'] }),
    );
    writeFileSync(
      join(mediumRiskRoot, '.paqad/specs/f.plan-vs-actual.json'),
      JSON.stringify({ unplanned_files: ['src/medium'] }),
    );
    writeFileSync(
      join(mediumRiskRoot, '.paqad/cache/classification-history.json'),
      JSON.stringify([{ timestamp: new Date().toISOString(), high_override_rate: false }]),
    );
    vi.mocked(queryPatterns).mockResolvedValueOnce([
      {
        pattern_id: 'p-medium',
        subcategory: 'bug',
        description: 'repeat',
        frequency: 7,
        recency: new Date().toISOString(),
        stack_contexts: [],
        example_obligations: [],
        example_files: ['src/medium.ts'],
        severity_distribution: { critical: 0, major: 0, minor: 0, info: 0 },
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        stale: false,
      },
    ] as never);
    const mediumRisk = await new PostClassifier(mediumRiskRoot).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'bug-fix',
        workflow_source: 'routing-skill',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: ['src/medium'],
        process_depth: 'fast lane',
        certainty: 'well-defined',
        output_type: 'code',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
      {} as never,
      {} as never,
    );
    expect(mediumRisk.risk_floor).toBe('medium');
    expect(mediumRisk.risk).toBe('medium');
    expect(mediumRisk.lane_before_override).toBe('fast');

    const bugFixGraduated = await new PostClassifier().adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'bug-fix',
        workflow_source: 'routing-skill',
        complexity: 'medium',
        risk: 'low',
        scope: 'single-file',
        affected_modules: [],
        process_depth: 'graduated lane',
        certainty: 'well-defined',
        output_type: 'code',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
      {} as never,
      {} as never,
    );
    expect(bugFixGraduated.lane_before_override).toBe('graduated');

    const emptyAffectedRoot = mkdtempSync(join(tmpdir(), 'paqad-post-empty-'));
    mkdirSync(join(emptyAffectedRoot, '.paqad/specs'), { recursive: true });
    writeFileSync(
      join(emptyAffectedRoot, '.paqad/specs/empty-a.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 10 }),
    );
    writeFileSync(
      join(emptyAffectedRoot, '.paqad/specs/empty-b.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 10 }),
    );
    writeFileSync(
      join(emptyAffectedRoot, '.paqad/specs/empty-c.plan-vs-actual.json'),
      JSON.stringify({ scope_accuracy_pct: 10 }),
    );
    vi.mocked(queryPatterns).mockResolvedValueOnce([]);
    const emptyAffected = await new PostClassifier(emptyAffectedRoot).adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'feature-development',
        workflow_source: 'routing-skill',
        complexity: 'low',
        risk: 'low',
        scope: 'single-file',
        affected_modules: [],
        process_depth: 'fast lane',
        certainty: 'well-defined',
        output_type: 'code',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
      {} as never,
      {} as never,
    );
    expect(emptyAffected.complexity_adjustment).toBe(1);

    const noProjectRoot = await new PostClassifier().adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'investigation',
        workflow_source: 'routing-skill',
        complexity: 'trivial',
        risk: 'low',
        scope: 'single-file',
        affected_modules: [],
        process_depth: 'fast lane',
        certainty: 'well-defined',
        output_type: 'analysis',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
      {} as never,
      {} as never,
    );
    expect(noProjectRoot.lane_before_override).toBe('fast');

    const projectQuestionLane = await new PostClassifier().adjust(
      {
        request_text: 'x',
        domain: 'coding',
        stack: 'react',
        target_capability: 'coding',
        capability_gap: false,
        workflow: 'project-question',
        workflow_source: 'routing-skill',
        complexity: 'high',
        risk: 'high',
        scope: 'single-file',
        affected_modules: [],
        process_depth: 'fast lane',
        certainty: 'well-defined',
        output_type: 'analysis',
        database_impact: 'none',
        ui_impact: 'none',
        api_impact: 'none',
        compliance_sensitivity: 'none',
        customer_facing_impact: 'internal',
        reversibility: 'easily-reversible',
        data_sensitivity: 'none',
      },
      {} as never,
      {} as never,
    );
    expect(projectQuestionLane.lane_before_override).toBe('fast');

    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValue({
      modules: [],
      source: 'default',
    });
    const routed = await new PreClassifier(process.cwd()).classify({
      request: 'unknown',
      resolved_workflow: { workflow: 'bug-fix' },
    });
    expect(routed.resolved.workflow).toBe('bug-fix');

    vi.spyOn(ModuleResolver.prototype, 'resolve').mockResolvedValueOnce({
      modules: [{ path: 'src/ragged', source: 'rag', confidence: 0.75 }],
      source: 'rag',
    });
    vi.spyOn(ruleTriggerMatcher, 'matchRuleTriggers').mockResolvedValueOnce([]);
    const nullWorkflow = await new PreClassifier(process.cwd()).classify({
      request: 'unknown request',
      resolved_workflow: { workflow: null },
    });
    expect(nullWorkflow.resolved.workflow).toBeUndefined();
    expect(nullWorkflow.resolution_map.affected_modules).toBe('deterministic:rag');
    expect(nullWorkflow.resolution_map.matched_rule_triggers).toBe('default');

    vi.restoreAllMocks();

    const preRoot = mkdtempSync(join(tmpdir(), 'paqad-pre-rules-'));
    mkdirSync(join(preRoot, '.paqad'), { recursive: true });
    mkdirSync(join(preRoot, 'src/api'), { recursive: true });
    writeFileSync(join(preRoot, 'src/api/users.ts'), 'export const users = true;\n');
    writeFileSync(
      join(preRoot, '.paqad/compiled-rules.json'),
      JSON.stringify({
        schema_version: 1,
        generated_at: new Date().toISOString(),
        source_hash: 'sha256:pre',
        rules: [
          {
            rule_id: 'RULE-PRE',
            title: 'API',
            source_path: 'x',
            trigger_patterns: ['src/api/*'],
            severity: 'must',
            summary: 'x',
          },
        ],
      }),
    );
    const matchedRules = await new PreClassifier(preRoot).classify({
      request: 'update src/api/users.ts',
    });
    expect(matchedRules.resolution_map.matched_rule_triggers).toBe('deterministic');
    expect(matchedRules.evidence).toContain('modules:explicit-path');

    const ruleRoot = mkdtempSync(join(tmpdir(), 'paqad-rules-extra-'));
    mkdirSync(join(ruleRoot, '.paqad'), { recursive: true });
    writeFileSync(
      join(ruleRoot, '.paqad/compiled-rules.json'),
      JSON.stringify({
        schema_version: 1,
        generated_at: new Date().toISOString(),
        source_hash: 'sha256:test',
        rules: [
          {
            rule_id: 'RULE-1',
            title: 'Exact',
            source_path: 'x',
            trigger_patterns: ['src/exact/path'],
            severity: 'must',
            summary: 'x',
          },
        ],
      }),
    );
    await expect(matchRuleTriggers(ruleRoot, ['src/exact/path'])).resolves.toEqual(['RULE-1']);
    writeFileSync(
      join(ruleRoot, '.paqad/compiled-rules.json'),
      JSON.stringify({
        schema_version: 1,
        generated_at: new Date().toISOString(),
        source_hash: 'sha256:test2',
        rules: [
          {
            rule_id: 'RULE-2',
            title: 'Globish',
            source_path: 'x',
            trigger_patterns: ['src/*'],
            severity: 'must',
            summary: 'x',
          },
        ],
      }),
    );
    await expect(matchRuleTriggers(ruleRoot, ['src/api/users'])).resolves.toEqual(['RULE-2']);

    const scopeRoot = mkdtempSync(join(tmpdir(), 'paqad-scope-extra-'));
    mkdirSync(join(scopeRoot, 'src'), { recursive: true });
    writeFileSync(join(scopeRoot, 'src/a.ts'), "export {} from '';\n");
    writeFileSync(join(scopeRoot, 'src/b.ts'), "const dep = require('./dep');\nexport { dep };\n");
    writeFileSync(join(scopeRoot, 'src/dep.ts'), 'export const dep = true;\n');
    const scope = await resolveScope(scopeRoot, ['src/a.ts', 'src/b.ts']);
    expect(scope.scope).toBe('multi-module');
    writeFileSync(join(scopeRoot, 'src/c.ts'), 'export const c = true;\n');
    writeFileSync(join(scopeRoot, 'src/d.ts'), 'export const d = true;\n');
    const singleModuleScope = await resolveScope(scopeRoot, ['src/c.ts', 'src/d.ts']);
    expect(singleModuleScope).toEqual({
      scope: 'multi-module',
      scope_graph_depth: 0,
    });
    const badHealthRoot = mkdtempSync(join(tmpdir(), 'paqad-health-extra-'));
    mkdirSync(join(badHealthRoot, '.paqad/module-health'), { recursive: true });
    writeFileSync(join(badHealthRoot, '.paqad/module-health/bad.json'), '{bad');
    expect(await readAllModuleHealth(badHealthRoot)).toEqual([]);
  });
});
