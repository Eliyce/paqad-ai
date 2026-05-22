import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import fg from 'fast-glob';
import { describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

import { selectReviewMode, selectReviewTier } from '@/pipeline/phases/spec-review.js';
import { PATHS } from '@/core/constants/paths.js';
import type { PhaseExecutor } from '@/pipeline/phases/phase.interface.js';
import { LaneRunner } from '@/pipeline/lane-runner.js';
import { PipelineRouter } from '@/pipeline/router.js';
import { WorkflowRouterService } from '@/pipeline/workflow-router.js';
import { Resolver } from '@/resolver/resolver.js';
import { RunnerScriptGenerator } from '@/scripts/index.js';
import { WorkflowEngine } from '@/workflows/engine.js';
import { PredictiveCache } from '@/cache/predictive-cache.js';

import { scriptProfile } from '../scripts/shared.fixture.js';
import { fixtureClassification } from './shared.fixture.js';

class FailingVerificationPhase implements PhaseExecutor {
  readonly phase = 'verification-gates' as const;

  async execute() {
    return {
      phase: this.phase,
      status: 'fail' as const,
      summary: 'Verification blocked',
      artifacts: [],
    };
  }
}

describe('LaneRunner', () => {
  it('full lane executes all phases in order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({ projectRoot: root }).runFullLane(fixtureClassification());

    expect(result.blocked_at).toBeNull();
    expect(result.phases.map((phase) => phase.phase)).toEqual([
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

  it('returns without running phases when no workflow matched', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: null,
        workflow_source: 'none',
        workflow_reason: 'No workflow routing rule matched the incoming request.',
        matched_rule: null,
      }),
    );

    expect(result.lane).toBeNull();
    expect(result.blocked_at).toBeNull();
    expect(result.phases).toEqual([]);
    expect(readFileSync(result.handoff_path, 'utf8')).toContain('"workflow": null');
    expect(readFileSync(result.handoff_path, 'utf8')).toContain('lane:none');
    expect(readFileSync(join(root, PATHS.ACTIVE_IMPLEMENTATION_SESSION), 'utf8')).toContain(
      '"active": false',
    );
  });

  it('graduated lane executes reduced phases', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({ projectRoot: root }).runGraduatedLane(
      fixtureClassification({
        complexity: 'medium',
        risk: 'medium',
        process_depth: 'graduated lane',
      }),
    );

    expect(result.blocked_at).toBeNull();
    expect(result.phases).toHaveLength(10);
    expect(result.phases.map((phase) => phase.phase)).not.toContain('user-flow');
  });

  it('runs only the graduated analysis roles', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({ projectRoot: root }).runGraduatedLane(
      fixtureClassification({
        complexity: 'medium',
        risk: 'low',
        database_impact: 'schema-change',
        process_depth: 'graduated lane',
      }),
    );

    expect(result.analysisRoles).toHaveLength(3);
    expect(result.analysisRoles.map((role) => role.name)).toEqual(
      expect.arrayContaining(['context-curator', 'solution-architect', 'database-expert']),
    );
    expect(result.analysisRoles.map((role) => role.name)).not.toContain('market-researcher');
    expect(result.analysisRoles.map((role) => role.name)).not.toContain('ux-ui-analyst');
    expect(result.analysisRoles.map((role) => role.name)).not.toContain('product-owner');
  });

  it('excludes database-expert in graduated lane when there is no DB impact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({ projectRoot: root }).runGraduatedLane(
      fixtureClassification({
        complexity: 'medium',
        risk: 'low',
        database_impact: 'none',
        process_depth: 'graduated lane',
      }),
    );

    expect(result.analysisRoles.map((role) => role.name)).not.toContain('database-expert');
  });

  it('uses standard review tier for graduated lane', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({ projectRoot: root }).runGraduatedLane(
      fixtureClassification({
        complexity: 'medium',
        risk: 'medium',
        process_depth: 'graduated lane',
      }),
    );

    expect(result.reviewTier).toBe('standard');
  });

  it('fast lane executes minimal phases', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({ projectRoot: root }).runFastLane(
      fixtureClassification({ complexity: 'trivial', risk: 'low', process_depth: 'fast lane' }),
    );

    expect(result.blocked_at).toBeNull();
    expect(result.phases.map((phase) => phase.phase)).toEqual([
      'request-classification',
      'docs-first-load',
      'implementation',
      'implementation-review',
      'verification-gates',
      'documentation-update',
    ]);
  });

  it('gate failure blocks forward progress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({
      projectRoot: root,
      phaseOverrides: {
        'verification-gates': new FailingVerificationPhase(),
      },
    }).runFastLane(
      fixtureClassification({ complexity: 'trivial', risk: 'low', process_depth: 'fast lane' }),
    );

    expect(result.blocked_at).toBe('verification-gates');
    expect(result.phases.map((phase) => phase.phase)).toEqual([
      'request-classification',
      'docs-first-load',
      'implementation',
      'implementation-review',
      'verification-gates',
    ]);
  });

  it('handoff artifact written after each phase', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({ projectRoot: root }).runFastLane(
      fixtureClassification({ complexity: 'trivial', risk: 'low', process_depth: 'fast lane' }),
    );

    const handoff = JSON.parse(readFileSync(result.handoff_path, 'utf8')) as {
      current_phase: string;
    };
    expect(handoff.current_phase).toBe('documentation-update');
  });

  it('writes workflow metadata into the handoff artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    const result = await new LaneRunner({ projectRoot: root }).runFastLane(
      fixtureClassification({ complexity: 'trivial', risk: 'low', process_depth: 'fast lane' }),
    );

    const handoff = JSON.parse(readFileSync(result.handoff_path, 'utf8')) as {
      workflow: string;
      key_decisions: string[];
    };

    expect(handoff.workflow).toBe('feature-development');
    expect(handoff.key_decisions).toContain('workflow:feature-development');
  });

  it('writes a machine-readable closure summary into the handoff artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(
      join(root, PATHS.CHANGED_FILES),
      JSON.stringify([
        'src/pipeline/lane-runner.ts',
        'tests/unit/pipeline/lane-runner.test.ts',
        'docs/modules/session/index/summary.md',
      ]),
    );

    const result = await new LaneRunner({ projectRoot: root }).runFastLane(
      fixtureClassification({ complexity: 'trivial', risk: 'low', process_depth: 'fast lane' }),
    );

    const handoff = JSON.parse(readFileSync(result.handoff_path, 'utf8')) as {
      closure_summary: {
        code_changed: boolean;
        test_evidence_changed: boolean;
        canonical_docs_changed: boolean;
        blocked: boolean;
        primary_blocking_reason: string | null;
        summary: string;
      };
      verification_results: Array<{ gate: string; passed: boolean }>;
    };

    expect(handoff.closure_summary).toMatchObject({
      code_changed: true,
      test_evidence_changed: true,
      canonical_docs_changed: true,
      blocked: true,
      primary_blocking_reason: expect.stringContaining('Only weak test evidence recorded'),
    });
    expect(handoff.closure_summary.summary).toContain('blocked=yes');
    expect(handoff.verification_results.length).toBeGreaterThan(0);
  });

  it('returns closure summary details on blocked runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(join(root, PATHS.CHANGED_FILES), JSON.stringify(['src/pipeline/lane-runner.ts']));

    const result = await new LaneRunner({
      projectRoot: root,
      phaseOverrides: {
        'verification-gates': new FailingVerificationPhase(),
      },
    }).runFastLane(
      fixtureClassification({ complexity: 'trivial', risk: 'low', process_depth: 'fast lane' }),
    );

    expect(result.closure_summary).toMatchObject({
      code_changed: true,
      test_evidence_changed: false,
      canonical_docs_changed: false,
      blocked: true,
      primary_blocking_reason: 'Verification blocked',
    });
  });

  it('uses feature development policy metadata in phase summaries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-policy-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, PATHS.PROJECT_PROFILE),
      YAML.stringify({
        project: { name: 'Demo', id: 'demo', description: 'Demo' },
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['laravel'],
          traits: [],
          toolchains: [
            { ecosystem: 'php', package_manager: 'composer', lockfile: 'composer.lock' },
          ],
          version_bands: [],
          sources: [{ file: 'composer.json', kind: 'manifest', detail: 'manifest' }],
        },
        commands: {
          install: 'pnpm install',
          dev: 'pnpm dev',
          test: 'pnpm test',
          test_single: 'pnpm test -- <pattern>',
          lint: 'pnpm lint',
          format: 'pnpm format',
          migrate: 'php artisan migrate',
          build: 'pnpm build',
        },
        strictness: {
          full_lane_default: false,
          require_adversarial_review: true,
          block_on_stale_docs: true,
          require_db_review_for_migrations: true,
        },
        compliance_packs: [],
        features: {
          spec_only_mode: false,
          market_research: false,
          design_research: false,
          team_agents: true,
          supply_chain_governance: false,
          ai_governance: false,
        },
        mcp: { servers: [] },
        model_routing: {
          default_model: 'gpt-5',
          reasoning_model: 'gpt-5',
          fast_model: 'gpt-5-mini',
        },
        research: { depth: 'standard' },
        efficiency: {
          context_hit_rate_target: 0.7,
          skill_caching: true,
          differential_refresh: true,
          mcp_first: true,
        },
        escalation: {
          destructive_operations: 'block',
          risky_migrations: 'warn',
          security_findings: 'block',
          db_row_threshold: 10000,
        },
        custom: {
          classification_dimensions: [],
          verification_plugins: [],
          escalation_rules: [],
        },
      }),
    );
    writeFileSync(
      join(root, 'docs/instructions/workflows/feature-development.yaml'),
      YAML.stringify({
        schema_version: '1',
        stages: {
          planning: { read: ['docs/custom/**'] },
          checks: { checks: { shell_commands: ['pnpm typecheck'] } },
          development: { instructions: ['Use feature flags where possible'] },
          review: { artifacts: ['risk summary'] },
        },
      }),
    );

    const result = await new LaneRunner({ projectRoot: root }).runGraduatedLane(
      fixtureClassification({
        complexity: 'medium',
        risk: 'medium',
        process_depth: 'graduated lane',
      }),
    );

    expect(result.phases.find((phase) => phase.phase === 'docs-first-load')?.summary).toContain(
      'reads',
    );
    expect(result.phases.find((phase) => phase.phase === 'implementation')?.summary).toContain(
      'instruction',
    );
    expect(result.phases.find((phase) => phase.phase === 'verification-gates')?.summary).toContain(
      'pnpm typecheck',
    );
  });

  it('blocks verification when a required logical command is missing from the project profile', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-policy-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, PATHS.PROJECT_PROFILE),
      YAML.stringify({
        project: { name: 'Demo', id: 'demo', description: 'Demo' },
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['laravel'],
          traits: [],
          toolchains: [
            { ecosystem: 'php', package_manager: 'composer', lockfile: 'composer.lock' },
          ],
          version_bands: [],
          sources: [{ file: 'composer.json', kind: 'manifest', detail: 'manifest' }],
        },
        commands: {
          install: 'pnpm install',
          dev: 'pnpm dev',
          test: 'pnpm test',
          test_single: 'pnpm test -- <pattern>',
          lint: 'pnpm lint',
          format: 'pnpm format',
          migrate: 'php artisan migrate',
          build: '',
        },
        strictness: {
          full_lane_default: false,
          require_adversarial_review: true,
          block_on_stale_docs: true,
          require_db_review_for_migrations: true,
        },
        compliance_packs: [],
        features: {
          spec_only_mode: false,
          market_research: false,
          design_research: false,
          team_agents: true,
          supply_chain_governance: false,
          ai_governance: false,
        },
        mcp: { servers: [] },
        model_routing: {
          default_model: 'gpt-5',
          reasoning_model: 'gpt-5',
          fast_model: 'gpt-5-mini',
        },
        research: { depth: 'standard' },
        efficiency: {
          context_hit_rate_target: 0.7,
          skill_caching: true,
          differential_refresh: true,
          mcp_first: true,
        },
        escalation: {
          destructive_operations: 'block',
          risky_migrations: 'warn',
          security_findings: 'block',
          db_row_threshold: 10000,
        },
        custom: {
          classification_dimensions: [],
          verification_plugins: [],
          escalation_rules: [],
        },
      }),
    );
    writeFileSync(
      join(root, 'docs/instructions/workflows/feature-development.yaml'),
      YAML.stringify({
        schema_version: '1',
        stages: {
          checks: {
            checks: {
              commands: ['build'],
              block_on_failure: true,
            },
          },
        },
      }),
    );

    const result = await new LaneRunner({ projectRoot: root }).runFastLane(
      fixtureClassification({ complexity: 'trivial', risk: 'low', process_depth: 'fast lane' }),
    );

    expect(result.blocked_at).toBe('verification-gates');
    expect(result.phases.find((phase) => phase.phase === 'verification-gates')?.summary).toContain(
      'requested project command "build"',
    );
  });

  it('runs the documentation workflow for documentation-only requests', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-docs-'));
    mkdirSync(join(root, 'app/Http/Controllers'), { recursive: true });
    mkdirSync(join(root, 'routes'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, 'app/Http/Controllers/UserController.php'),
      '<?php class UserController {}',
    );
    writeFileSync(join(root, 'routes/web.php'), "<?php Route::get('/users', fn () => 'ok');");
    writeFileSync(join(root, 'artisan'), '');
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^12.0' } }),
    );
    writeFileSync(
      join(root, PATHS.PROJECT_PROFILE),
      YAML.stringify({
        project: { name: 'Demo', id: 'demo', description: 'Demo' },
        routing: { domain: 'coding', stack: 'laravel', capabilities: [] },
        commands: {
          install: 'pnpm install',
          dev: 'pnpm dev',
          test: 'pnpm test',
          test_single: 'pnpm test -- one',
          lint: 'pnpm lint',
          format: 'pnpm format',
          migrate: 'php artisan migrate',
          build: 'pnpm build',
        },
        strictness: {
          full_lane_default: false,
          require_adversarial_review: true,
          block_on_stale_docs: true,
          require_db_review_for_migrations: true,
        },
        compliance_packs: [],
        features: {
          spec_only_mode: false,
          market_research: false,
          design_research: false,
          team_agents: true,
          supply_chain_governance: false,
          ai_governance: false,
        },
        mcp: { servers: [] },
        model_routing: {
          default_model: 'gpt-5',
          reasoning_model: 'gpt-5',
          fast_model: 'gpt-5-mini',
        },
        research: { depth: 'standard' },
        efficiency: {
          context_hit_rate_target: 0.7,
          skill_caching: true,
          differential_refresh: true,
          mcp_first: true,
        },
        escalation: {
          destructive_operations: 'block',
          risky_migrations: 'warn',
          security_findings: 'block',
          db_row_threshold: 10000,
        },
        custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
      }),
    );

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'documentation-update',
        output_type: 'documentation',
        complexity: 'medium',
        risk: 'low',
        process_depth: 'graduated lane',
      }),
    );

    expect(result.blocked_at).toBeNull();
    expect(result.phases.map((phase) => phase.phase)).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'documentation-update',
    ]);
    // documentation-update now writes the module map (foundation stage), not full module docs
    expect(existsSync(join(root, 'docs/instructions/rules/module-map.yml'))).toBe(true);
    expect(existsSync(join(root, 'docs/modules'))).toBe(false);
  });

  it('uses workflow-router resolution when running a raw request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-request-'));
    const resolveSpy = vi.spyOn(WorkflowRouterService.prototype, 'resolve').mockResolvedValue({
      workflow: 'project-question',
      custom_workflow_name: null,
      workflow_source: 'routing-skill',
      workflow_reason: 'Matched question workflow.',
      matched_rule: 'question',
    });

    const result = await new LaneRunner({ projectRoot: root }).runRequest(
      'How does billing routing work?',
    );

    expect(resolveSpy).toHaveBeenCalledWith('How does billing routing work?', null);
    expect(result.lane).toBe('fast');
    expect(result.phases.map((phase) => phase.phase)).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'question-answering',
    ]);

    resolveSpy.mockRestore();
  });

  it('persists an active implementation session artifact while coding work is still open', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-'));
    mkdirSync(join(root, '.paqad', 'session'), { recursive: true });
    writeFileSync(
      join(root, PATHS.CHANGED_FILES),
      JSON.stringify(['src/pipeline/classifier.ts', 'tests/unit/pipeline/classifier.test.ts']),
      'utf8',
    );

    await new LaneRunner({
      projectRoot: root,
      phaseOverrides: { 'verification-gates': new FailingVerificationPhase() },
    }).runFastLane(
      fixtureClassification({
        workflow: 'bug-fix',
        complexity: 'low',
        risk: 'low',
        process_depth: 'fast lane',
      }),
    );

    const artifact = JSON.parse(
      readFileSync(join(root, PATHS.ACTIVE_IMPLEMENTATION_SESSION), 'utf8'),
    ) as { active: boolean; pending_verification: boolean; workflow: string };

    expect(artifact.workflow).toBe('bug-fix');
    expect(artifact.active).toBe(true);
    expect(artifact.pending_verification).toBe(true);
  });

  it('runs custom workflow templates through the workflow engine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-custom-'));
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/workflows/feature-with-review.yaml'),
      `name: feature-with-review
description: Test template
steps:
  - skill: scope-check
`,
    );

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'feature-with-review',
        workflow_reason: 'Matched workflow-router rule "feature with review".',
        matched_rule: 'feature with review',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.blocked_at).toBeNull();
    expect(result.phases).toEqual([]);
    expect(result.lane).toBe('graduated');
    expect(existsSync(join(root, '.paqad/workflows/feature-with-review'))).toBe(true);
    const executionArtifacts = await fg('*.json', {
      cwd: join(root, '.paqad/workflows/feature-with-review/executions'),
      absolute: true,
    });
    expect(executionArtifacts).toHaveLength(1);
    expect(readFileSync(executionArtifacts[0]!, 'utf8')).toContain('"skill": "scope-check"');
  });

  it('allows custom workflow templates to reference project-owned skills', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-custom-'));
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    mkdirSync(join(root, '.codex/skills/request-router'), { recursive: true });
    writeFileSync(
      join(root, '.codex/skills/request-router/SKILL.md'),
      `---
name: project-scope-check
description: Project local skill
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: true
cache_key_inputs: [request_text]
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
---
Body.
`,
    );
    writeFileSync(
      join(root, 'docs/instructions/workflows/project-review.yaml'),
      `name: project-review
description: Test template
steps:
  - skill: project-scope-check
`,
    );

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'project-review',
        workflow_reason: 'Matched workflow-router rule "project review".',
        matched_rule: 'project review',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.blocked_at).toBeNull();
    expect(result.lane).toBe('graduated');
    expect(existsSync(join(root, '.paqad/workflows/project-review'))).toBe(true);
    const executionArtifacts = await fg('*.json', {
      cwd: join(root, '.paqad/workflows/project-review/executions'),
      absolute: true,
    });
    expect(executionArtifacts).toHaveLength(1);
    expect(readFileSync(executionArtifacts[0]!, 'utf8')).toContain(
      '"skill": "project-scope-check"',
    );
  });

  it('returns a blocked result when custom workflow validation throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-custom-'));
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/workflows/broken-review.yaml'),
      `name: broken-review
description: Broken template
steps:
  - skill: missing-skill
`,
    );

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'broken-review',
        workflow_reason: 'Matched workflow-router rule "broken review".',
        matched_rule: 'broken review',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.blocked_at).toBe('request-classification');
    expect(result.phases).toEqual([]);
    expect(result.route_reason).toContain('Invalid workflow template "broken-review"');
  });

  it('rejects malformed project-owned skills instead of falling back to the folder name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-custom-'));
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    mkdirSync(join(root, '.codex/skills/project-scope-check'), { recursive: true });
    writeFileSync(
      join(root, '.codex/skills/project-scope-check/SKILL.md'),
      '# malformed project skill without frontmatter\n',
    );
    writeFileSync(
      join(root, 'docs/instructions/workflows/project-review.yaml'),
      `name: project-review
description: Test template
steps:
  - skill: project-scope-check
`,
    );

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'project-review',
        workflow_reason: 'Matched workflow-router rule "project review".',
        matched_rule: 'project review',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.blocked_at).toBe('request-classification');
    expect(result.phases).toEqual([]);
    expect(result.route_reason).toContain('SKILL.md must start with YAML frontmatter');
  });

  it('propagates failed custom workflow runs as blocked pipeline results', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-custom-'));
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/workflows/feature-with-review.yaml'),
      `name: feature-with-review
description: Test template
steps:
  - skill: scope-check
`,
    );

    const runSpy = vi.spyOn(WorkflowEngine.prototype, 'run').mockResolvedValue({
      schema_version: '1',
      run_id: 'run-1',
      template_name: 'feature-with-review',
      status: 'failed',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: [],
    });

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'feature-with-review',
        workflow_reason: 'Matched workflow-router rule "feature with review".',
        matched_rule: 'feature with review',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(runSpy).toHaveBeenCalled();
    expect(result.blocked_at).toBe('request-classification');
    expect(result.phases).toEqual([]);
    expect(result.route_reason).toContain('failed');
    runSpy.mockRestore();
  });

  it('propagates aborted custom workflow runs as blocked pipeline results', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-custom-'));
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/workflows/feature-with-review.yaml'),
      `name: feature-with-review
description: Test template
steps:
  - skill: scope-check
`,
    );

    const runSpy = vi.spyOn(WorkflowEngine.prototype, 'run').mockResolvedValue({
      schema_version: '1',
      run_id: 'run-1',
      template_name: 'feature-with-review',
      status: 'aborted',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      steps: [],
    });

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'feature-with-review',
        workflow_reason: 'Matched workflow-router rule "feature with review".',
        matched_rule: 'feature with review',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.blocked_at).toBe('request-classification');
    expect(result.route_reason).toContain('aborted');
    runSpy.mockRestore();
  });

  it('falls back to a generic custom workflow failure message for non-Error throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-custom-'));
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/workflows/feature-with-review.yaml'),
      `name: feature-with-review
description: Test template
steps:
  - skill: scope-check
`,
    );

    const runSpy = vi.spyOn(WorkflowEngine.prototype, 'run').mockRejectedValue('boom');

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'feature-with-review',
        workflow_reason: 'Matched workflow-router rule "feature with review".',
        matched_rule: 'feature with review',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.blocked_at).toBe('request-classification');
    expect(result.route_reason).toBe('Custom workflow execution failed.');
    runSpy.mockRestore();
  });

  it('rejects custom routing when the workflow name is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-custom-'));

    await expect(
      new LaneRunner({ projectRoot: root }).run(
        fixtureClassification({
          workflow: 'custom',
          custom_workflow_name: null,
          workflow_reason: 'Matched custom route.',
          matched_rule: 'custom',
        }),
      ),
    ).rejects.toThrow('Custom workflow routing requires custom_workflow_name');
  });

  it('falls back to lane selection from the classification when the router returns no lane', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-fallback-lane-'));
    const routeSpy = vi.spyOn(PipelineRouter.prototype, 'route').mockReturnValue({
      lane: null,
      phases: ['request-classification', 'docs-first-load'],
      route_reason: 'Router deferred to classifier fallback.',
    });

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'bug-fix',
        complexity: 'low',
        risk: 'low',
        process_depth: 'fast lane',
      }),
    );

    expect(result.lane).toBe('fast');
    expect(result.route_reason).toBe('Router deferred to classifier fallback.');
    expect(result.analysisRoles).toEqual([]);

    routeSpy.mockRestore();
  });

  it('runs the RCA workflow and writes a canonical RCA artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-rca-'));
    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        request_text: 'Run a root cause analysis for checkout failures after deployment',
        workflow: 'root-cause-analysis',
        output_type: 'report',
        complexity: 'medium',
        risk: 'low',
      }),
    );

    expect(result.blocked_at).toBeNull();
    expect(result.phases.map((phase) => phase.phase)).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'root-cause-analysis',
      'documentation-update',
    ]);

    const artifactPath = result.phases
      .find((phase) => phase.phase === 'root-cause-analysis')
      ?.artifacts.find((artifact) => artifact.startsWith('docs/rca/'));

    expect(artifactPath).toMatch(
      /^docs\/rca\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-run-a-root-cause-analysis-for-checkout-failures-after-deployment\.md$/,
    );
    expect(readFileSync(join(root, artifactPath as string), 'utf8')).toContain('## Solution');
  });

  it('runs the project-question workflow without implementation or documentation phases', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-question-'));
    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        request_text: 'How does the billing pipeline decide which workflow to run?',
        workflow: 'project-question',
        output_type: 'analysis',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.blocked_at).toBeNull();
    expect(result.lane).toBe('fast');
    expect(result.phases.map((phase) => phase.phase)).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'question-answering',
    ]);
  });

  it('runs the pentest workflow and writes a canonical pentest artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-pentest-'));
    mkdirSync(join(root, 'docs/modules/billing/api'), { recursive: true });
    mkdirSync(join(root, 'docs/modules/billing/integration'), { recursive: true });
    mkdirSync(join(root, 'docs/modules/billing/ui'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { react: '^19.0.0' } }),
    );
    writeFileSync(
      join(root, 'docs/modules/billing/business.md'),
      '# Billing\n\nAdmins approve refunds.\n',
    );
    writeFileSync(
      join(root, 'docs/modules/billing/technical.md'),
      '# Technical\n\nWorkflow states.\n',
    );
    writeFileSync(join(root, 'docs/modules/billing/api/endpoints.md'), '# Endpoints\n\n');
    writeFileSync(join(root, 'docs/modules/billing/integration/contracts.md'), '# Contracts\n\n');
    writeFileSync(join(root, 'docs/modules/billing/ui/states.md'), '# States\n\n');
    writeFileSync(join(root, 'docs/modules/billing/error-catalog.md'), '# Errors\n\n');
    await new RunnerScriptGenerator().write(root, scriptProfile('laravel'));

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        request_text: 'Run a pentest for the billing application',
        workflow: 'pentest',
        output_type: 'report',
        complexity: 'high',
        risk: 'medium',
        process_depth: 'graduated lane',
      }),
    );

    expect(result.blocked_at).toBeNull();
    expect(result.phases.map((phase) => phase.phase)).toEqual([
      'request-classification',
      'docs-first-load',
      'analysis',
      'pentest',
    ]);

    const artifactPath = result.phases
      .find((phase) => phase.phase === 'pentest')
      ?.artifacts.find((artifact) => artifact.startsWith('docs/pentest/'));

    expect(artifactPath).toMatch(/^docs\/pentest\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
    expect(readFileSync(join(root, artifactPath as string), 'utf8')).toContain(
      '## Detailed Findings',
    );
  });
});

describe('review tier selection', () => {
  const classification = fixtureClassification();

  it('selects full tier for full lane', () => {
    expect(selectReviewTier(classification, 'full')).toBe('full');
  });

  it('selects standard tier for graduated lane', () => {
    expect(selectReviewTier(classification, 'graduated')).toBe('standard');
  });

  it('selects spot-check tier for fast lane', () => {
    expect(selectReviewTier(classification, 'fast')).toBe('spot-check');
  });
});

describe('review diff mode', () => {
  it('uses fresh mode for first review', () => {
    expect(selectReviewMode(false, 0)).toBe('fresh');
  });

  it('uses diff mode for re-review with small changes', () => {
    expect(selectReviewMode(true, 0.3)).toBe('diff');
  });

  it('falls back to fresh mode when >60% changed', () => {
    expect(selectReviewMode(true, 0.7)).toBe('fresh');
  });
});

describe('lane selection fallbacks', () => {
  it.each([['writing'], ['editing'], ['planning'], ['research'], ['investigation']] as const)(
    'routes %s workflows to the fast lane when the router defers',
    async (workflow) => {
      const root = mkdtempSync(join(tmpdir(), `paqad-pipeline-${workflow}-`));
      const routeSpy = vi.spyOn(PipelineRouter.prototype, 'route').mockReturnValue({
        lane: null,
        phases: ['request-classification'],
        route_reason: `Router deferred ${workflow}.`,
      });

      const result = await new LaneRunner({ projectRoot: root }).run(
        fixtureClassification({
          workflow,
          complexity: 'high',
          risk: 'high',
        }),
      );

      expect(result.lane).toBe('fast');
      expect(result.route_reason).toBe(`Router deferred ${workflow}.`);
      routeSpy.mockRestore();
    },
  );

  it('routes pentest-retest workflows to the graduated lane when the router defers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-pentest-retest-'));
    const routeSpy = vi.spyOn(PipelineRouter.prototype, 'route').mockReturnValue({
      lane: null,
      phases: ['request-classification'],
      route_reason: 'Router deferred pentest-retest.',
    });

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'pentest-retest',
        complexity: 'high',
        risk: 'high',
      }),
    );

    expect(result.lane).toBe('graduated');
    routeSpy.mockRestore();
  });

  it('routes migrations to the full lane when the router defers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-migration-'));
    const routeSpy = vi.spyOn(PipelineRouter.prototype, 'route').mockReturnValue({
      lane: null,
      phases: ['request-classification'],
      route_reason: 'Router deferred migration.',
    });

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'migration',
        complexity: 'low',
        risk: 'low',
      }),
    );

    expect(result.lane).toBe('full');
    routeSpy.mockRestore();
  });

  it('routes risky feature development to the full lane when the router defers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-feature-full-'));
    const routeSpy = vi.spyOn(PipelineRouter.prototype, 'route').mockReturnValue({
      lane: null,
      phases: ['request-classification'],
      route_reason: 'Router deferred feature-development.',
    });

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'feature-development',
        complexity: 'medium',
        risk: 'high',
      }),
    );

    expect(result.lane).toBe('full');
    routeSpy.mockRestore();
  });

  it('routes non-trivial bug fixes to the graduated lane when the router defers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-bugfix-graduated-'));
    const routeSpy = vi.spyOn(PipelineRouter.prototype, 'route').mockReturnValue({
      lane: null,
      phases: ['request-classification'],
      route_reason: 'Router deferred bug-fix.',
    });

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'bug-fix',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.lane).toBe('graduated');
    routeSpy.mockRestore();
  });

  it('routes medium-complexity low-risk work to the graduated lane when the router defers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-medium-graduated-'));
    const routeSpy = vi.spyOn(PipelineRouter.prototype, 'route').mockReturnValue({
      lane: null,
      phases: ['request-classification'],
      route_reason: 'Router deferred medium work.',
    });

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'implementation-review',
        complexity: 'medium',
        risk: 'low',
      }),
    );

    expect(result.lane).toBe('graduated');
    routeSpy.mockRestore();
  });

  it('routes high-complexity high-risk uncategorized work to the full lane when the router defers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-full-fallback-'));
    const routeSpy = vi.spyOn(PipelineRouter.prototype, 'route').mockReturnValue({
      lane: null,
      phases: ['request-classification'],
      route_reason: 'Router deferred to final fallback.',
    });

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'implementation-review',
        complexity: 'high',
        risk: 'high',
      }),
    );

    expect(result.lane).toBe('full');
    routeSpy.mockRestore();
  });
});

describe('custom workflow skill discovery', () => {
  it('falls back to the skill folder name for malformed resolved skills', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-custom-skill-fallback-'));
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    mkdirSync(join(root, 'runtime-scope-check'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/workflows/runtime-skill-review.yaml'),
      `name: runtime-skill-review
description: Test template
steps:
  - skill: runtime-scope-check
`,
    );
    writeFileSync(
      join(root, 'runtime-scope-check', 'SKILL.md'),
      '# malformed runtime skill without frontmatter\n',
    );

    const resolveSpy = vi.spyOn(Resolver.prototype, 'resolve').mockResolvedValue({
      skills: [
        {
          path: join(root, 'runtime-scope-check', 'SKILL.md'),
          level: 1,
          source: 'test',
        },
      ],
    } as never);

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'runtime-skill-review',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.blocked_at).toBeNull();
    expect(result.lane).toBe('graduated');
    const executionArtifacts = await fg('*.json', {
      cwd: join(root, '.paqad/workflows/runtime-skill-review/executions'),
      absolute: true,
    });
    expect(executionArtifacts).toHaveLength(1);

    resolveSpy.mockRestore();
  });
});

describe('predictive cache wiring in LaneRunner custom workflows', () => {
  it('invokes PredictiveCache.onSkillComplete after each custom workflow step completes', async () => {
    const onSkillComplete = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(PredictiveCache.prototype, 'onSkillComplete').mockImplementation(onSkillComplete);

    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-pred-cache-'));
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/workflows/cache-test-workflow.yaml'),
      `name: cache-test-workflow
description: Tests predictive cache wiring
steps:
  - skill: scope-check
  - skill: sequence-planner
`,
    );

    const result = await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'cache-test-workflow',
        workflow_reason: 'Matched cache test workflow.',
        matched_rule: 'cache-test',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    expect(result.blocked_at).toBeNull();
    expect(onSkillComplete).toHaveBeenCalledTimes(2);
    const skillNames = onSkillComplete.mock.calls.map((call) => (call as string[])[3]);
    expect(skillNames).toEqual(['scope-check', 'sequence-planner']);

    vi.restoreAllMocks();
  });

  it('respects efficiency.predictive_cache: false from the project profile to disable prewarming', async () => {
    const onSkillComplete = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(PredictiveCache.prototype, 'onSkillComplete').mockImplementation(onSkillComplete);

    const root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-pred-cache-disabled-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    mkdirSync(join(root, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(root, PATHS.PROJECT_PROFILE),
      YAML.stringify({
        project: { name: 'Demo', id: 'demo', description: 'Demo' },
        active_capabilities: ['content'],
        commands: {
          install: 'pnpm install',
          dev: 'pnpm dev',
          test: 'pnpm test',
          test_single: 'pnpm test -- one',
          lint: 'pnpm lint',
          format: 'pnpm format',
          migrate: 'pnpm migrate',
          build: 'pnpm build',
        },
        strictness: {
          full_lane_default: false,
          require_adversarial_review: false,
          block_on_stale_docs: false,
          require_db_review_for_migrations: false,
        },
        compliance_packs: [],
        features: {
          spec_only_mode: false,
          market_research: false,
          design_research: false,
          team_agents: false,
          supply_chain_governance: false,
          ai_governance: false,
        },
        mcp: { servers: [] },
        model_routing: {
          default_model: 'gpt-5',
          reasoning_model: 'gpt-5',
          fast_model: 'gpt-5-mini',
        },
        research: { depth: 'standard' },
        efficiency: { predictive_cache: false },
        escalation: {
          destructive_operations: 'block',
          risky_migrations: 'warn',
          security_findings: 'block',
          db_row_threshold: 10000,
        },
        custom: {
          classification_dimensions: [],
          verification_plugins: [],
          escalation_rules: [],
        },
      }),
    );
    writeFileSync(
      join(root, 'docs/instructions/workflows/cache-disabled-workflow.yaml'),
      `name: cache-disabled-workflow
description: Tests that cache is disabled from profile
steps:
  - skill: scope-check
`,
    );

    await new LaneRunner({ projectRoot: root }).run(
      fixtureClassification({
        workflow: 'custom',
        custom_workflow_name: 'cache-disabled-workflow',
        workflow_reason: 'Matched cache-disabled workflow.',
        matched_rule: 'cache-disabled',
        complexity: 'medium',
        risk: 'medium',
      }),
    );

    // onSkillComplete is still called (transition logging), but prewarm is skipped internally
    expect(onSkillComplete).toHaveBeenCalledOnce();
    const [, , , skillName] = onSkillComplete.mock.calls[0] as string[];
    expect(skillName).toBe('scope-check');

    vi.restoreAllMocks();
  });
});
