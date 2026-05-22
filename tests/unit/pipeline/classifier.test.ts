import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { RequestClassifier } from '@/pipeline/classifier.js';

describe('RequestClassifier', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-classifier-'));
    mkdirSync(join(projectRoot, '.paqad/specs'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('derives documentation metadata from a routed documentation workflow', async () => {
    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'lets created documenation for this app',
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
      resolved_workflow: {
        workflow: 'documentation-update',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched workflow-router rule "created documenation".',
        matched_rule: 'created documenation',
      },
    });

    expect(result.workflow).toBe('documentation-update');
    expect(result.output_type).toBe('documentation');
    expect(result.scope).toBe('single-module');
    expect(result.workflow_source).toBe('routing-skill');
    expect(result.matched_rule).toBe('created documenation');
    expect(result.classification_confidence).toBeGreaterThan(0);
    expect(result.resolution_map?.workflow).toBe('llm-confirmed');
  });

  it('derives report metadata for security workflows', async () => {
    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'Run a pentest for the billing application',
      resolved_workflow: {
        workflow: 'pentest',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched workflow-router rule "run a pentest".',
        matched_rule: 'run a pentest',
      },
    });

    expect(result.workflow).toBe('pentest');
    expect(result.target_capability).toBe('security');
    expect(result.output_type).toBe('report');
    expect(result.complexity).toBe('high');
    expect(result.risk).toBe('high');
  });

  it('preserves explicit no-match routing without falling back to a workflow', async () => {
    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'do something useful maybe',
      resolved_workflow: {
        workflow: null,
        workflow_source: 'none',
        workflow_reason: 'No workflow routing rule matched the incoming request.',
        matched_rule: null,
      },
    });

    expect(result.workflow).toBeNull();
    expect(result.workflow_source).toBe('none');
    expect(result.output_type).toBe('analysis');
    expect(result.workflow_reason).toContain('No workflow routing rule matched');
  });

  it('derives high-risk coding metadata for schema, api, ui, and pii changes', async () => {
    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request:
        'Update the customer dashboard page, modify api route, add table column migration for pii payment data',
      profile: {
        active_capabilities: ['content'],
        stack_profile: {
          frameworks: ['laravel'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        routing: { domain: 'coding', stack: 'laravel', capabilities: [] },
      },
      resolved_workflow: {
        workflow: 'feature-development',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched feature-development route.',
        matched_rule: 'feature',
      },
    });

    expect(result.target_capability).toBe('coding');
    expect(result.capability_gap).toBe(true);
    expect(result.domain).toBe('coding');
    expect(result.stack).toBe('laravel');
    expect(result.database_impact).toBe('schema-change');
    expect(result.api_impact).toBe('modified-endpoint');
    expect(result.ui_impact).toBe('new-screen');
    expect(result.complexity).toBe('high');
    expect(result.risk).toBe('high');
    expect(result.process_depth).toBe('full lane');
    expect(result.customer_facing_impact).toBe('customer-visible');
    expect(result.reversibility).toBe('easily-reversible');
    expect(result.data_sensitivity).toBe('pii');
    expect(result.affected_modules).toEqual([
      'database/migrations',
      'app/Http/Controllers',
      'routes',
      'resources/views',
      'resources/js/pages',
    ]);
  });

  it('derives content-domain defaults for short-video and additive analysis requests', async () => {
    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'Research docs for a component button question?',
      profile: {
        active_capabilities: ['content'],
        stack_profile: {
          frameworks: ['short-video'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        routing: { domain: 'content', stack: 'short-video', capabilities: [] },
      },
      resolved_workflow: {
        workflow: 'research',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched research route.',
        matched_rule: 'research',
      },
    });

    expect(result.target_capability).toBe('content');
    expect(result.domain).toBe('content');
    expect(result.stack).toBe('short-video');
    expect(result.output_type).toBe('analysis');
    expect(result.complexity).toBe('low');
    expect(result.risk).toBe('low');
    expect(result.scope).toBe('single-module');
    expect(result.process_depth).toBe('fast lane');
    expect(result.certainty).toBe('partially-defined');
    expect(result.ui_impact).toBe('new-component');
  });

  it('detects security capability gaps and difficult reversibility for breaking changes', async () => {
    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'Run security review for breaking endpoint redesign with data migration and gdpr',
      profile: {
        active_capabilities: ['content', 'coding'],
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        routing: { domain: 'coding', stack: 'react', capabilities: [] },
      },
      resolved_workflow: {
        workflow: null,
        workflow_source: 'none',
        workflow_reason: 'No workflow routing rule matched the incoming request.',
        matched_rule: null,
      },
    });

    expect(result.target_capability).toBe('security');
    expect(result.capability_gap).toBe(true);
    expect(result.database_impact).toBe('data-migration');
    expect(result.api_impact).toBe('breaking-change');
    expect(result.ui_impact).toBe('redesign');
    expect(result.compliance_sensitivity).toBe('high');
    expect(result.reversibility).toBe('difficult');
    expect(result.risk).toBe('high');
  });

  it('prefers explicit repo path prefixes over heuristic free-text tokens', async () => {
    mkdirSync(join(projectRoot, 'src/billing'), { recursive: true });
    writeFileSync(join(projectRoot, 'src/billing/invoices.ts'), 'export const invoices = true;\n');
    mkdirSync(join(projectRoot, 'app/Http/Controllers'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'app/Http/Controllers/BillingController.php'),
      '<?php class BillingController {}',
    );
    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'Update src/billing/invoices and app/Http/Controllers/BillingController.php',
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
      resolved_workflow: {
        workflow: 'feature-development',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched feature-development route.',
        matched_rule: 'feature',
      },
    });

    expect(result.affected_modules).toEqual([
      'src/billing/invoices',
      'app/Http/Controllers/BillingController',
    ]);
  });

  it('maps react UI requests to metadata-filterable path prefixes', async () => {
    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'Update the settings page component and its api route',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        routing: { domain: 'coding', stack: 'react', capabilities: [] },
      },
      resolved_workflow: {
        workflow: 'feature-development',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched feature-development route.',
        matched_rule: 'feature',
      },
    });

    expect(result.affected_modules).toEqual([
      'src/api',
      'src/server',
      'src/pages',
      'src/screens',
      'src/components',
    ]);
  });

  it('emits trivial single-file signals for tiny rename requests', async () => {
    mkdirSync(join(projectRoot, 'src/components'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/components/Button.tsx'),
      'export const Button = () => null;\n',
    );
    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'Rename src/components/Button.tsx to IconButton.tsx with a one-line cleanup',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        routing: { domain: 'coding', stack: 'react', capabilities: [] },
      },
      resolved_workflow: {
        workflow: 'cleanup',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched cleanup route.',
        matched_rule: 'cleanup',
      },
    });

    expect(result.complexity).toBe('trivial');
    expect(result.scope).toBe('single-file');
    expect(result.process_depth).toBe('fast lane');
    expect(result.affected_modules).toEqual(['src/components/Button']);
  });

  it('applies delta metadata and health-based risk overrides', async () => {
    writeFileSync(
      join(projectRoot, '.paqad/specs/base.yaml'),
      [
        'plan_version: 1',
        'plan_mode: full',
        'feature_id: base',
        'slug: base',
        'created_at: 2026-04-10T00:00:00.000Z',
        'base_manifest_hash: null',
        'classification:',
        '  workflow: feature-development',
        '  complexity: medium',
        '  risk: low',
        '  lane: graduated',
        '  domain: coding',
        '  stack: react',
        '  affected_modules:',
        '    - src/components/Button',
        'requirement_graph:',
        '  - id: R1',
        '    type: functional',
        '    description: one',
        '    depends_on: []',
        '    scope: [src/components/Button]',
        '    risk: low',
        'execution_slices: []',
        'verification_matrix:',
        '  - criterion_id: C1',
        '    given: one',
        '    when: two',
        '    then: three',
        '    proof_type: automated',
        '    status: uncovered',
        '    source: planned',
        '    linked_requirement_ids: [R1]',
        'decision_log: []',
        'doc_targets: []',
        'regression_watch: []',
      ].join('\n'),
    );
    mkdirSync(join(projectRoot, '.paqad/module-health/src/components'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad/module-health/src/components/Button.json'),
      JSON.stringify({
        module: 'src/components/Button',
        tier: 'fragile',
        metrics: { coverage_pct: 10, defect_frequency: 9, contract_stability: 0.3 },
        updated_at: new Date().toISOString(),
      }),
    );
    mkdirSync(join(projectRoot, 'src/components'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/components/Button.tsx'),
      'export const Button = () => null;\n',
    );

    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'Implement src/components/Button.tsx',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: {
        workflow: 'feature-development',
        workflow_source: 'routing-skill',
      },
    });

    expect(result.delta_candidate).toBe(true);
    expect(result.base_manifest_slug).toBe('base');
    expect(result.prior_requirement_count).toBe(1);
    expect(result.prior_criterion_count).toBe(1);
    expect(result.risk).toBe('high');
    expect(result.lane_before_override).toBe('graduated');
    expect(result.lane_override_reason).toContain('fragile');
  });

  it('uses buildFromPreResult path when shouldSkipLlm returns true', async () => {
    // Force the LLM-skip branch by mocking shouldSkipLlm to return true.
    const llmSkipModule = await import('@/pipeline/llm-skip-evaluator.js');
    vi.spyOn(llmSkipModule, 'shouldSkipLlm').mockReturnValue(true);

    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'investigate the bug in the auth module',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: {
        workflow: 'investigation',
        workflow_source: 'routing-skill',
      },
    });

    // With LLM skipped the classifier must still produce a valid result.
    expect(result.workflow).toBeDefined();
    expect(result.classification_confidence).toBeDefined();
    expect(result.resolution_map).toBeDefined();
  });

  it('resumes the active implementation workflow for non-explicit why follow-ups', async () => {
    mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
    writeFileSync(
      join(projectRoot, PATHS.ACTIVE_IMPLEMENTATION_SESSION),
      JSON.stringify(
        {
          version: 1,
          updated_at: new Date().toISOString(),
          active: true,
          workflow: 'feature-development',
          lane: 'full',
          current_phase: 'implementation-review',
          scope: 'multi-module',
          affected_modules: ['src/pipeline', 'src/session'],
          changed_files: ['src/pipeline/classifier.ts'],
          changed_files_source: 'session-artifact',
          has_code_changes: true,
          pending_verification: true,
          pending_documentation: true,
          unresolved_items: ['Verification blocked'],
        },
        null,
        2,
      ),
    );

    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'why',
      resolved_workflow: {
        workflow: 'project-question',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched question workflow.',
        matched_rule: 'why',
      },
    });

    expect(result.workflow).toBe('feature-development');
    expect(result.workflow_source).toBe('active-session');
    expect(result.resume_lane).toBe('full');
    expect(result.resumed_from_session).toBe(true);
    expect(result.workflow_continuity_reason).toContain('implementation lane');
    expect(result.affected_modules).toEqual(['src/pipeline', 'src/session']);
    expect(result.resolution_map?.workflow).toBe('session-resume');
  });

  it('allows explicit explanation-only follow-ups to stay question-only', async () => {
    mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
    writeFileSync(
      join(projectRoot, PATHS.ACTIVE_IMPLEMENTATION_SESSION),
      JSON.stringify(
        {
          version: 1,
          updated_at: new Date().toISOString(),
          active: true,
          workflow: 'feature-development',
          lane: 'graduated',
          current_phase: 'implementation',
          scope: 'single-module',
          affected_modules: ['src/pipeline'],
          changed_files: ['src/pipeline/classifier.ts'],
          changed_files_source: 'session-artifact',
          has_code_changes: true,
          pending_verification: true,
          pending_documentation: true,
          unresolved_items: [],
        },
        null,
        2,
      ),
    );

    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'Explain only, do not change code',
      resolved_workflow: {
        workflow: 'project-question',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched question workflow.',
        matched_rule: 'explain',
      },
    });

    expect(result.workflow).toBe('project-question');
    expect(result.workflow_source).toBe('routing-skill');
    expect(result.resumed_from_session).toBe(false);
    expect(result.workflow_continuity_reason).toContain(
      'explicitly requested explanation-only guidance',
    );
  });

  it('resumes active implementation continuity for documentation-update follow-ups', async () => {
    mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
    writeFileSync(
      join(projectRoot, PATHS.ACTIVE_IMPLEMENTATION_SESSION),
      JSON.stringify(
        {
          version: 1,
          updated_at: new Date().toISOString(),
          active: true,
          workflow: 'feature-development',
          lane: 'graduated',
          current_phase: 'implementation-review',
          scope: 'single-module',
          affected_modules: ['src/session'],
          changed_files: ['src/session/active-implementation.ts'],
          changed_files_source: 'session-artifact',
          has_code_changes: true,
          pending_verification: true,
          pending_documentation: true,
          unresolved_items: ['Verification blocked'],
        },
        null,
        2,
      ),
    );

    const classifier = new RequestClassifier({ projectRoot });
    const result = await classifier.classify({
      request: 'update the docs for that too',
      resolved_workflow: {
        workflow: 'documentation-update',
        workflow_source: 'routing-skill',
        workflow_reason: 'Matched documentation workflow.',
        matched_rule: 'update the docs',
      },
    });

    expect(result.workflow).toBe('feature-development');
    expect(result.workflow_source).toBe('active-session');
    expect(result.resumed_from_session).toBe(true);
    expect(result.resume_lane).toBe('graduated');
  });
});
