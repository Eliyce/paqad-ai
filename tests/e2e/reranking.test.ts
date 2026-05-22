import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi } from 'vitest';

import { SemanticLoader } from '@/context/semantic-loader.js';
import { writeProjectProfile } from '@/core/project-profile.js';

function makeProfile(projectRoot: string, rerankingEnabled: boolean) {
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
      supply_chain_governance: false,
      ai_governance: false,
    },
    mcp: { servers: [] },
    model_routing: { default_model: 'gpt-5', reasoning_model: 'gpt-5', fast_model: 'gpt-5-mini' },
    research: { depth: 'standard' },
    intelligence: {
      rag_enabled: false,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
      reranking: rerankingEnabled
        ? { enabled: true, backend: 'passthrough', candidate_pool_size: 10 }
        : { enabled: false, backend: 'passthrough' },
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

describe('Reranking — end-to-end', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-reranking-e2e-'));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/auth.ts'),
      'export function ensureAdmin(user: User) { return gate("admin"); }\n',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reranking stats absent when disabled', async () => {
    makeProfile(projectRoot, false);

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-rerank-off' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/auth.ts'), content: 'auth function' }],
      { taskKeywords: ['auth'], tokenBudget: 1000, symbolReferences: [] },
    );

    expect(result.stats.reranking).toBeUndefined();
  });

  it('reranking stats present when enabled (passthrough backend)', async () => {
    makeProfile(projectRoot, true);

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-rerank-on' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/auth.ts'), content: 'auth function' }],
      { taskKeywords: ['auth'], tokenBudget: 1000, symbolReferences: [] },
    );

    expect(result.stats.reranking).toBeDefined();
    expect(result.stats.reranking?.enabled).toBe(true);
    expect(result.stats.reranking?.backend).toBe('passthrough');
    expect(result.stats.reranking?.candidate_pool_size).toBe(10);
    expect(Array.isArray(result.stats.reranking?.pre_rerank_chunk_ids)).toBe(true);
    expect(Array.isArray(result.stats.reranking?.post_rerank_chunk_ids)).toBe(true);
  });

  it('passthrough reranker preserves scorer order (pre == post)', async () => {
    makeProfile(projectRoot, true);

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-rerank-order' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/auth.ts'), content: 'auth function' }],
      { taskKeywords: ['auth'], tokenBudget: 1000, symbolReferences: [] },
    );

    expect(result.stats.reranking?.pre_rerank_chunk_ids).toEqual(
      result.stats.reranking?.post_rerank_chunk_ids,
    );
  });

  it('packed set never exceeds reranked input size', async () => {
    makeProfile(projectRoot, true);

    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-rerank-packed' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/auth.ts'), content: 'auth function' }],
      { taskKeywords: ['auth'], tokenBudget: 1000, symbolReferences: [] },
    );

    const postRerankSize = result.stats.reranking?.post_rerank_chunk_ids.length ?? 0;
    expect(result.chunks.length).toBeLessThanOrEqual(postRerankSize || Infinity);
  });
});
