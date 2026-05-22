import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SemanticLoader } from '@/context/semantic-loader.js';
import {
  selectRetrievalDepth,
  escalateDepth,
  topNForDepth,
} from '@/context/retrieval-depth-router.js';
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
      adaptive_retrieval: { enabled: true, thresholds: { min_useful_chunks: 3 } },
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

describe('Adaptive Retrieval Depth — end-to-end', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-adaptive-e2e-'));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/auth.ts'),
      'export function ensureAdmin(user: User) { return gate("admin"); }\n',
    );
    makeProfile(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('router returns none for trivial single-file classification', () => {
    expect(selectRetrievalDepth({ complexity: 'trivial', scope: 'single-file' })).toBe('none');
  });

  it('router returns deep for high-complexity classification', () => {
    expect(selectRetrievalDepth({ complexity: 'high' })).toBe('deep');
  });

  it('router returns standard for medium complexity', () => {
    expect(selectRetrievalDepth({ complexity: 'medium', risk: 'low' })).toBe('standard');
  });

  it('topNForDepth returns 0 for none, base for standard, base*3 for deep', () => {
    expect(topNForDepth('none', 20)).toBe(0);
    expect(topNForDepth('standard', 20)).toBe(20);
    expect(topNForDepth('deep', 20)).toBe(60);
  });

  it('escalateDepth is bounded: none→standard→deep→deep', () => {
    expect(escalateDepth('none')).toBe('standard');
    expect(escalateDepth('standard')).toBe('deep');
    expect(escalateDepth('deep')).toBe('deep');
  });

  it('SemanticLoader records retrieval_depth=none in stats for trivial single-file task', async () => {
    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-depth-none' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/auth.ts'), content: 'auth function' }],
      {
        taskKeywords: ['rename'],
        tokenBudget: 1000,
        symbolReferences: [],
        classification: { complexity: 'trivial', scope: 'single-file' },
      },
    );

    expect(result.stats.retrieval_depth).toBe('none');
    expect(result.stats.retrieval_escalated).toBeUndefined();
  });

  it('SemanticLoader records retrieval_depth=deep in stats for high-complexity task', async () => {
    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-depth-deep' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/auth.ts'), content: 'auth function' }],
      {
        taskKeywords: ['refactor'],
        tokenBudget: 1000,
        symbolReferences: [],
        classification: { complexity: 'high', scope: 'system-wide' },
      },
    );

    expect(result.stats.retrieval_depth).toBe('deep');
  });

  it('SemanticLoader records retrieval_depth=standard when no classification provided', async () => {
    const loader = new SemanticLoader({ projectRoot, sessionId: 'e2e-depth-standard' });
    const result = await loader.load(
      [{ path: join(projectRoot, 'src/auth.ts'), content: 'auth function' }],
      {
        taskKeywords: ['auth'],
        tokenBudget: 1000,
        symbolReferences: [],
      },
    );

    // No classification → defaults to standard
    expect(result.stats.retrieval_depth).toBe('standard');
  });
});
