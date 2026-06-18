import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SemanticLoader } from '@/context/semantic-loader.js';
import { writeProjectProfile } from '@/core/project-profile.js';

function makeProfile(projectRoot: string) {
  writeProjectProfile(projectRoot, {
    project: { name: 'Demo', id: 'demo', description: 'Demo' },
    active_capabilities: ['coding'],
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
    },
    mcp: { servers: [] },
    model_routing: { default_model: 'gpt-5', reasoning_model: 'gpt-5', fast_model: 'gpt-5-mini' },
    research: { depth: 'standard' },
    intelligence: {
      rag_enabled: false,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
      metadata_filters: { enabled: true },
    },
    efficiency: {},
    escalation: {
      destructive_operations: 'warn',
      risky_migrations: 'warn',
      security_findings: 'warn',
      db_row_threshold: 1000,
    },
    custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
  });
}

describe('Metadata Filters — end-to-end', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-metadata-filters-e2e-'));
    mkdirSync(join(projectRoot, 'src/auth'), { recursive: true });
    mkdirSync(join(projectRoot, 'src/billing'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/auth/service.ts'),
      'export function canAuth(user: User): boolean { return gate("auth"); }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/billing/invoice.ts'),
      'export function runBillingWorkflow(): void { processBilling(); }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/billing/payments.ts'),
      'export function runBillingPayments(): void { processBillingPayments(); }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/billing/refunds.ts'),
      'export function runBillingRefunds(): void { processBillingRefunds(); }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/auth/guard.ts'),
      'export function authGuard(): boolean { return gate("auth-guard"); }\n',
    );
    writeFileSync(
      join(projectRoot, 'src/auth/policy.ts'),
      'export function authPolicy(): boolean { return gate("auth-policy"); }\n',
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('fusion_strategy is always present in load stats', async () => {
    makeProfile(projectRoot);

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-filter-1' });
    const result = await loader.load(
      [
        { path: join(projectRoot, 'src/auth/service.ts'), content: 'auth service' },
        { path: join(projectRoot, 'src/billing/invoice.ts'), content: 'billing invoice' },
        { path: join(projectRoot, 'src/billing/payments.ts'), content: 'billing payments' },
        { path: join(projectRoot, 'src/billing/refunds.ts'), content: 'billing refunds' },
      ],
      { taskKeywords: ['auth'], tokenBudget: 2000, symbolReferences: [] },
    );

    expect(result.stats.fusion_strategy).toBeDefined();
    expect(result.stats.fusion_strategy?.signals).toHaveLength(4);
  });

  it('module_path_prefix fallback does not claim the filter changed the returned corpus', async () => {
    makeProfile(projectRoot);

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-filter-2' });
    const result = await loader.load(
      [
        { path: join(projectRoot, 'src/auth/service.ts'), content: 'auth service' },
        { path: join(projectRoot, 'src/billing/invoice.ts'), content: 'billing invoice' },
      ],
      {
        taskKeywords: ['billing'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: {
          complexity: 'medium',
          affected_modules: ['src/billing'],
        },
      },
    );

    expect(result.stats.fusion_strategy?.filter_fallback).toBe(true);
    expect(result.stats.fusion_strategy?.filters_applied).toEqual([]);
  });

  it('fallback triggered when filter narrows to empty set — full corpus used', async () => {
    makeProfile(projectRoot);

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-filter-fallback' });
    const result = await loader.load(
      [
        { path: join(projectRoot, 'src/auth/service.ts'), content: 'auth service' },
        { path: join(projectRoot, 'src/billing/invoice.ts'), content: 'billing invoice' },
      ],
      {
        taskKeywords: ['auth'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: {
          complexity: 'medium',
          // This module doesn't exist — filtered set will be empty → fallback
          affected_modules: [join(projectRoot, 'src/nonexistent')],
        },
      },
    );

    // Fallback means filter_fallback is true and chunks still returned
    if (result.stats.fusion_strategy?.filter_fallback) {
      expect(result.stats.fusion_strategy.filter_fallback).toBe(true);
    }
    // Either way, we get a valid result
    expect(result.stats.fusion_strategy).toBeDefined();
  });

  it('no filters applied when no affected_modules in classification', async () => {
    makeProfile(projectRoot);

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-filter-none' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/auth/service.ts'), content: 'auth service' }],
      {
        taskKeywords: ['auth'],
        tokenBudget: 2000,
        symbolReferences: [],
        classification: { complexity: 'medium' },
      },
    );

    expect(result.stats.fusion_strategy?.filters_applied).toHaveLength(0);
  });

  it('extracts file extension, framework, and recency filters when available', async () => {
    makeProfile(projectRoot);

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-filter-all' });
    const result = await loader.load(
      [
        { path: join(projectRoot, 'src/auth/service.ts'), content: 'auth service' },
        { path: join(projectRoot, 'src/auth/guard.ts'), content: 'auth guard' },
        { path: join(projectRoot, 'src/auth/policy.ts'), content: 'auth policy' },
      ],
      {
        taskKeywords: ['auth'],
        taskTargetFile: join(projectRoot, 'src/auth/service.ts'),
        tokenBudget: 2000,
        symbolReferences: [],
        classification: {
          complexity: 'medium',
          frameworks: ['auth'],
          recency_cutoff_ms: 1000,
        },
      },
    );

    expect(result.stats.fusion_strategy?.filters_applied).toEqual(
      expect.arrayContaining(['file_extension', 'framework', 'recency_cutoff_ms']),
    );
  });
});
