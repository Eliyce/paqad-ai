import { readFileSync } from 'node:fs';

import {
  ADAPTER_TYPES,
  AGENT_ROLES,
  API_IMPACTS,
  CLASSIFICATION_CERTAINTY,
  CLASSIFICATION_WORKFLOWS,
  CLASSIFICATION_OUTPUT_TYPES,
  CLASSIFICATION_SCOPES,
  COMPLIANCE_SENSITIVITY_LEVELS,
  CONTEXT_LEVELS,
  CONTEXT_LEVEL_BUDGETS,
  CUSTOMER_FACING_IMPACTS,
  DATABASE_IMPACTS,
  DEFAULT_CONTEXT_BUDGET,
  DOC_TYPES,
  ESCALATION_MODES,
  FINDING_SEVERITIES,
  HEALTH_CHECK_STATUSES,
  HOOK_EXIT_CODES,
  HOOK_TRIGGERS,
  MCP_SERVER_TYPES,
  PLAN_MODES,
  PLANNING_LANES,
  PLANNING_MANIFEST_VERSION,
  PROOF_TYPES,
  CRITERION_STATUSES,
  HEALTH_TIERS,
  REQUIREMENT_TYPES,
  PIPELINE_PHASES,
  PROCESS_DEPTHS,
  RESEARCH_DEPTHS,
  REVIEW_MODES,
  REVIEW_TIERS,
  REVERSIBILITY_LEVELS,
  resolveContextBudgetForModel,
  ROLE_TOKEN_BUDGETS,
  ROLLBACK_CLASSES,
  SUPPORTED_CAPABILITIES,
  SUPPORTED_DOMAINS,
  SUPPORTED_STACKS,
  UI_IMPACTS,
  VERIFICATION_GATES,
  VERSION,
  getFrameworkName,
} from '@/index';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
).version;

describe('core export surface', () => {
  it('re-exports the package identity', () => {
    expect(VERSION).toBe(packageVersion);
    expect(getFrameworkName()).toBe('paqad-ai');
  });

  it('re-exports the supported domains, stacks, and capabilities', () => {
    expect(SUPPORTED_DOMAINS).toEqual(['coding', 'content']);
    expect(SUPPORTED_STACKS).toEqual([
      'laravel',
      'flutter',
      'react',
      'vue',
      'django',
      'fastapi',
      'rails',
      'spring-boot',
      'express',
      'angular',
      'svelte',
      'astro',
      'go-web',
      'rust-web',
      'dotnet',
      'nextjs',
      'flask',
      'nestjs',
      'kotlin-android',
      'node-cli',
      'node-library',
      'node-service',
      'short-video',
    ]);
    expect(SUPPORTED_CAPABILITIES).toEqual([
      'inertia',
      'vue',
      'react',
      'tailwind',
      'boost',
      'pest',
      'phpunit',
      'docker',
      'compose',
      'sail',
      'next',
      'remix',
      'vite-spa',
      'gatsby',
      'nuxt',
      'quasar',
      'blazor',
      'ef-core',
      'minimal-api',
      'mvc',
      'razor-pages',
      'signalr',
      'azure',
      'identity',
      'app-router',
      'pages-router',
      'prisma',
      'trpc',
      'next-auth',
      'sqlalchemy',
      'celery',
      'blueprints',
      'flask-login',
      'flask-restx',
      'gunicorn',
      'typeorm',
      'graphql',
      'microservices',
      'swagger',
      'passport',
      'fastify',
      'jetpack-compose',
      'room',
      'hilt',
      'retrofit',
      'coroutines',
      'navigation',
      'datastore',
    ]);
  });

  it('re-exports phase and gate catalogs', () => {
    expect(PIPELINE_PHASES).toContain('verification-gates');
    expect(PIPELINE_PHASES).toContain('pentest');
    expect(PIPELINE_PHASES).toContain('pentest-retest');
    expect(VERIFICATION_GATES).toHaveLength(14);
    expect(VERIFICATION_GATES[0]).toBe('change-completeness');
    expect(REVIEW_TIERS).toEqual(['full', 'standard', 'spot-check']);
    expect(REVIEW_MODES).toEqual(['fresh', 'diff']);
    expect(FINDING_SEVERITIES).toEqual(['critical', 'high', 'medium', 'low']);
  });

  it('re-exports adapter, hook, and MCP catalogs', () => {
    expect(ADAPTER_TYPES).toEqual([
      'claude-code',
      'codex-cli',
      'antigravity',
      'gemini-cli',
      'junie',
      'cursor',
      'github-copilot',
      'windsurf',
      'continue',
      'aider',
    ]);
    expect(HOOK_TRIGGERS).toContain('pre-compact');
    expect(HOOK_EXIT_CODES).toEqual({ ALLOW: 0, ERROR: 1, BLOCK: 2 });
    expect(MCP_SERVER_TYPES).toContain('database-inspector');
  });

  it('re-exports classification dimensions and controls', () => {
    expect(CLASSIFICATION_WORKFLOWS).toContain('project-question');
    expect(CLASSIFICATION_WORKFLOWS).toContain('query-optimization');
    expect(CLASSIFICATION_WORKFLOWS).toContain('root-cause-analysis');
    expect(CLASSIFICATION_WORKFLOWS).toContain('pentest');
    expect(CLASSIFICATION_WORKFLOWS).toContain('pentest-retest');
    expect(CLASSIFICATION_SCOPES).toContain('system-wide');
    expect(CLASSIFICATION_CERTAINTY).toContain('ambiguous');
    expect(CLASSIFICATION_OUTPUT_TYPES).toContain('report');
    expect(DATABASE_IMPACTS).toContain('data-migration');
    expect(UI_IMPACTS).toContain('redesign');
    expect(API_IMPACTS).toContain('breaking-change');
    expect(COMPLIANCE_SENSITIVITY_LEVELS).toContain('high');
    expect(CUSTOMER_FACING_IMPACTS).toContain('customer-visible');
    expect(REVERSIBILITY_LEVELS).toContain('irreversible');
  });

  it('re-exports budget and context settings', () => {
    expect(CONTEXT_LEVELS).toEqual([0, 1, 2, 3, 4]);
    expect(DEFAULT_CONTEXT_BUDGET.main_agent_max).toBe(30000);
    expect(resolveContextBudgetForModel('gpt-5-mini').main_agent_max).toBe(18000);
    expect(CONTEXT_LEVEL_BUDGETS[4]).toBe(30000);
    expect(ROLE_TOKEN_BUDGETS.implementer).toBeGreaterThan(ROLE_TOKEN_BUDGETS.verifier);
    expect(PROCESS_DEPTHS).toEqual(['fast lane', 'graduated lane', 'full lane']);
  });

  it('re-exports research, escalation, agent, docs, and health enums', () => {
    expect(RESEARCH_DEPTHS).toEqual(['cutting-edge', 'standard', 'conservative']);
    expect(ESCALATION_MODES).toEqual(['block', 'require_approval', 'warn']);
    expect(AGENT_ROLES).toContain('reviewer');
    expect(DOC_TYPES).toContain('error-catalog');
    expect(HEALTH_CHECK_STATUSES).toEqual(['pass', 'fail', 'warning']);
  });

  it('re-exports planning manifest constants', () => {
    expect(PLANNING_MANIFEST_VERSION).toBe(1);
    expect(PLAN_MODES).toEqual({ FULL: 'full', DELTA: 'delta' });
    expect(PLANNING_LANES).toEqual({ FAST: 'fast', GRADUATED: 'graduated', FULL: 'full' });
    expect(REQUIREMENT_TYPES).toEqual({
      FUNCTIONAL: 'functional',
      NON_FUNCTIONAL: 'non-functional',
      CONSTRAINT: 'constraint',
      EDGE_CASE: 'edge-case',
    });
    expect(PROOF_TYPES).toEqual({ AUTOMATED: 'automated', MANUAL: 'manual', VISUAL: 'visual' });
    expect(CRITERION_STATUSES).toEqual({
      UNCOVERED: 'uncovered',
      COVERED: 'covered',
      PARTIAL: 'partial',
      INDETERMINATE: 'indeterminate',
    });
    expect(HEALTH_TIERS).toEqual({
      STABLE: 'stable',
      MODERATE: 'moderate',
      FRAGILE: 'fragile',
      UNKNOWN: 'unknown',
    });
    expect(ROLLBACK_CLASSES).toEqual({
      SAFE: 'safe',
      NEEDS_MIGRATION: 'needs-migration',
      DESTRUCTIVE: 'destructive',
    });
  });
});
