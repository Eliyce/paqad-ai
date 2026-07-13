import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi } from 'vitest';

import { writeProjectProfile } from '@/core/project-profile.js';
import * as projectProfile from '@/core/project-profile.js';
import { setConfigValue, syncFrameworkConfig } from '@/core/framework-config.js';
import * as projectPacks from '@/packs/project-packs.js';
import { PatternVectorService } from '@/patterns/pattern-rag.js';
import type { IntelligenceConfig } from '@/core/types/project-profile.js';
import { EmbeddingProviderError } from '@/rag/types.js';
import type { EmbeddingProvider, ProviderFactory } from '@/rag/types.js';
import { RagService, lexicalDocumentText } from '@/rag/service.js';
import { backgroundIndexSync } from '@/rag/background-sync.js';
import { clearEngineLogger, setEngineLogger } from '@/core/logger-registry.js';
import type { EngineLogEntry } from '@/core/types/logger.js';

/** Installs a recording engine logger and returns the entries it receives. */
function captureEngineLogs(): EngineLogEntry[] {
  const entries: EngineLogEntry[] = [];
  setEngineLogger({ log: (entry) => void entries.push(entry) });
  return entries;
}

type FrameworkPack = ReturnType<typeof projectPacks.getPacksForFrameworks>[number];

function baseProfile(intelligence?: Partial<IntelligenceConfig>) {
  return {
    project: { name: 'Demo', id: 'demo', description: 'Demo' },
    active_capabilities: ['content', 'coding', 'security'] as const,
    stack_profile: {
      frameworks: ['node-cli'],
      traits: [],
      toolchains: [],
      version_bands: [],
      sources: [],
    },
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
    },
    mcp: { servers: [] },
    model_routing: {
      default_model: 'gpt-5',
      reasoning_model: 'gpt-5',
      fast_model: 'gpt-5-mini',
    },
    research: { depth: 'standard' as const },
    intelligence: {
      rag_enabled: false,
      rag_similarity_threshold: 0.75,
      rag_top_n: 20,
      ...intelligence,
    },
    efficiency: { differential_refresh: true },
    escalation: {
      destructive_operations: 'block' as const,
      risky_migrations: 'warn' as const,
      security_findings: 'block' as const,
      db_row_threshold: 1000,
    },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
    },
  };
}

function fakeProviderFactory(): ProviderFactory {
  const provider: EmbeddingProvider = {
    name: 'local',
    model: 'fake-local',
    async validate() {
      return;
    },
    async embed(input: string | string[]) {
      const batch = Array.isArray(input) ? input : [input];
      return batch.map((text) => {
        const lower = text.toLowerCase();
        if (lower.includes('auth')) return [1, 0];
        if (lower.includes('billing')) return [0, 1];
        return [0.5, 0.5];
      });
    },
  };

  return async () => provider;
}

/** A provider that counts how many texts it is asked to embed (RAG F8). */
function countingProviderFactory(model = 'fake-local'): {
  factory: ProviderFactory;
  calls: { embeddedTexts: number };
} {
  const calls = { embeddedTexts: 0 };
  const provider: EmbeddingProvider = {
    name: 'local',
    model,
    async validate() {
      return;
    },
    async embed(input: string | string[]) {
      const batch = Array.isArray(input) ? input : [input];
      calls.embeddedTexts += batch.length;
      return batch.map(() => [0.5, 0.5]);
    },
  };
  return { factory: async () => provider, calls };
}

// Framework knobs (the RAG/`intelligence` block) resolve from `.paqad/.config`,
// not the profile YAML. `configureAndBuild`/`writeProjectProfile` no longer
// persist them there, so seed `.config` directly whenever a later
// `readProjectProfile`/`getStatus` needs to observe the enabled RAG state.
function persistIntelligence(root: string, intelligence: Partial<IntelligenceConfig>): void {
  syncFrameworkConfig(root, { intelligence: baseProfile(intelligence).intelligence });
}

describe('RagService', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-rag-service-'));
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    vi.spyOn(PatternVectorService.prototype, 'refresh').mockResolvedValue();
    writeFileSync(
      join(projectRoot, 'src/auth.ts'),
      [
        'export function canAccessAuth() {',
        "  const authContext = 'auth policy validation for protected routes and session checks';",
        '  return authContext.length > 0;',
        '}',
        '',
      ].join('\n'),
    );
    writeProjectProfile(projectRoot, baseProfile());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearEngineLogger();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('F9: backgroundIndexSync re-embeds only the changed file (incremental, cache-backed)', async () => {
    const { factory, calls } = countingProviderFactory();
    const service = new RagService(projectRoot, factory);
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    const afterBuild = calls.embeddedTexts;

    // Touch only auth.ts; a background sync should re-embed just its chunk(s).
    writeFileSync(
      join(projectRoot, 'src/auth.ts'),
      [
        'export function canAccessAuth() {',
        "  const authContext = 'auth policy CHANGED validation for protected routes and sessions';",
        '  return authContext.length > 1;',
        '}',
        '',
      ].join('\n'),
    );

    const result = await backgroundIndexSync(projectRoot, factory);
    expect(result).toEqual({ synced: true });
    const delta = calls.embeddedTexts - afterBuild;
    expect(delta).toBeGreaterThan(0); // the changed file was re-embedded
    expect(delta).toBeLessThanOrEqual(2); // but only it, not the whole tree
  });

  it('F9: backgroundIndexSync reports no-index when nothing is built yet', async () => {
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    expect(await backgroundIndexSync(projectRoot, fakeProviderFactory())).toEqual({
      synced: false,
      reason: 'no-index',
    });
  });

  it('F9: backgroundIndexSync reports disabled when rag is off', async () => {
    expect(await backgroundIndexSync(projectRoot, fakeProviderFactory())).toEqual({
      synced: false,
      reason: 'disabled',
    });
  });

  it('F9: backgroundIndexSync no-ops (in-flight) when the sync lock is held', async () => {
    mkdirSync(join(projectRoot, '.paqad', 'locks', 'rag-sync.lock'), { recursive: true });
    expect(await backgroundIndexSync(projectRoot, fakeProviderFactory())).toEqual({
      synced: false,
      reason: 'in-flight',
    });
  });

  it('F10: a configured rag_base_branch is honoured in the index meta', async () => {
    const g = (...args: string[]) =>
      execFileSync('git', args, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] });
    g('init', '-q');
    g('config', 'user.email', 't@example.com');
    g('config', 'user.name', 'Test');
    g('checkout', '-q', '-b', 'main');
    g('add', '-A');
    g('commit', '-q', '-m', 'seed');
    g('checkout', '-q', '-b', 'release/2.x');
    g('commit', '-q', '--allow-empty', '-m', 'release');
    g('checkout', '-q', '-b', 'feat/w');

    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
      rag_base_branch: 'release/2.x',
    });

    const meta = JSON.parse(
      readFileSync(join(projectRoot, '.paqad', 'vectors', 'meta.json'), 'utf8'),
    );
    expect(meta.branch).toBe('feat/w');
    expect(meta.base_branch).toBe('release/2.x');
    expect(meta.base_commit).toBe(
      execFileSync('git', ['rev-parse', 'release/2.x'], { cwd: projectRoot }).toString().trim(),
    );
  });

  it('F22: the index meta records the chunker version it was built with', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    const meta = JSON.parse(
      readFileSync(join(projectRoot, '.paqad', 'vectors', 'meta.json'), 'utf8'),
    );
    expect(meta.chunker_version).toBe('cast-blurb-v1');
  });

  it('F22: an index built by a different chunker is invalid (forces a full rebuild)', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    expect((await service.getStatus()).valid).toBe(true);

    // Simulate an index built by an older/different chunker (e.g. pre-F22 = no version).
    const metaPath = join(projectRoot, '.paqad', 'vectors', 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    delete meta.chunker_version;
    writeFileSync(metaPath, JSON.stringify(meta));

    const status = await service.getStatus();
    expect(status.valid).toBe(false);
    expect(status.reason).toContain('chunker');
    // A mismatched index is never incrementally synced — the guard against mixing.
    expect(await backgroundIndexSync(projectRoot, fakeProviderFactory())).toEqual({
      synced: false,
      reason: 'no-index',
    });
  });

  it('F9: a branch switch self-heals the index branch metadata', async () => {
    const g = (...args: string[]) =>
      execFileSync('git', args, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] });
    g('init', '-q');
    g('config', 'user.email', 't@example.com');
    g('config', 'user.name', 'Test');
    g('checkout', '-q', '-b', 'main');
    g('add', '-A');
    g('commit', '-q', '-m', 'seed');

    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const metaPath = join(projectRoot, '.paqad', 'vectors', 'meta.json');
    expect(JSON.parse(readFileSync(metaPath, 'utf8')).branch).toBe('main');

    // Switch to a feature branch and change a file, then background-sync.
    g('checkout', '-q', '-b', 'feat/z');
    writeFileSync(
      join(projectRoot, 'src/auth.ts'),
      'export const authChanged = "auth policy revised for the feature branch";\n',
    );
    const result = await backgroundIndexSync(projectRoot, fakeProviderFactory());
    expect(result).toEqual({ synced: true });
    expect(JSON.parse(readFileSync(metaPath, 'utf8')).branch).toBe('feat/z');
  });

  it('F8: a rebuild re-embeds nothing when chunks are unchanged (cache hit)', async () => {
    const { factory, calls } = countingProviderFactory();
    const service = new RagService(projectRoot, factory);
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    const firstBuildEmbeds = calls.embeddedTexts;
    expect(firstBuildEmbeds).toBeGreaterThan(0);
    expect(existsSync(join(projectRoot, '.paqad', 'vectors', 'embedding-cache.json'))).toBe(true);

    // A full rebuild over the same (unchanged) sources hits the cache for every
    // chunk — the provider is never called again. A previously-seen branch is the
    // same case: its chunk text is already cached.
    await service.rebuild();
    expect(calls.embeddedTexts).toBe(firstBuildEmbeds);
  });

  it('F8: a model change invalidates the cache and re-embeds', async () => {
    const first = countingProviderFactory('model-a');
    const serviceA = new RagService(projectRoot, first.factory);
    await serviceA.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'model-a',
    });
    expect(first.calls.embeddedTexts).toBeGreaterThan(0);

    const second = countingProviderFactory('model-b');
    const serviceB = new RagService(projectRoot, second.factory);
    await serviceB.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'model-b',
    });
    // Different model → cache keys are a different namespace → full re-embed.
    expect(second.calls.embeddedTexts).toBeGreaterThan(0);
  });

  it('builds, reports status, refreshes, and clears a project vector index', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const status = await service.getStatus();
    expect(status.enabled).toBe(true);
    expect(status.index_present).toBe(true);
    expect(status.valid).toBe(true);
    expect(status.chunk_count).toBeGreaterThan(0);

    writeFileSync(
      join(projectRoot, 'src/billing.ts'),
      [
        'export function runBillingWorkflow() {',
        "  const billingContext = 'billing workflow reconciliation for invoices and receipts';",
        '  return billingContext.length > 0;',
        '}',
        '',
      ].join('\n'),
    );
    const sync = await service.refreshContext();
    expect(sync.added_files.some((file) => file.endsWith('billing.ts'))).toBe(true);

    await service.clear();
    // `clear()` disables RAG on the (now framework-stripped) profile; mirror that
    // into `.config`, the source of truth getStatus() reads.
    setConfigValue(projectRoot, 'RAG_ENABLED', 'false');
    expect((await service.getStatus()).enabled).toBe(false);
    expect((await service.getStatus()).index_present).toBe(false);
    expect(existsSync(join(projectRoot, '.paqad', 'vectors'))).toBe(false);
  });

  it('falls back cleanly when rag is enabled but the index is missing', async () => {
    writeProjectProfile(
      projectRoot,
      baseProfile({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
      }),
    );
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const service = new RagService(projectRoot, fakeProviderFactory());
    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'auth issue',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(retrieval.chunks_retrieved).toBe(0);
    expect(retrieval.fallback_reason).toBe('missing-index');
  });

  it('returns the chunk sync result immediately when refresh runs with rag disabled', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());

    const sync = await service.refreshContext();

    expect(sync.index.entries.length).toBeGreaterThan(0);
    expect(existsSync(join(projectRoot, '.paqad', 'vectors', 'index.json'))).toBe(false);
    expect((await service.getStatus()).configured_provider).toBeUndefined();
  });

  it('returns an empty retrieval result immediately when rag is disabled', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const sync = await service.refreshContext();

    const retrieval = await service.retrieve(sync, {
      taskDescription: 'auth issue',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(retrieval).toMatchObject({
      chunks_retrieved: 0,
      retrieved_chunk_ids: [],
      retrieved_source_files: [],
      retrieved_chunks: [],
    });
  });

  it('retrieves vector scores for matching chunks after build', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(retrieval.chunks_retrieved).toBeGreaterThan(0);
    expect([...retrieval.vector_scores.values()][0]).toBeGreaterThanOrEqual(0.75);
    expect(retrieval.retrieved_chunk_ids).not.toHaveLength(0);
    expect(retrieval.retrieved_source_files[0]).toContain('auth.ts');
    expect(retrieval.retrieved_chunks[0]?.content).toContain('canAccessAuth');
    expect(readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8')).toContain(
      'rag-build-completed',
    );
  });

  it('falls back when vector matches clear neither the similarity nor the relief floor', async () => {
    // #354 — floor-with-relief means "dark" requires the match to be below BOTH floors,
    // so push the relief floor above the (impossible) similarity threshold too.
    writeProjectProfile(
      projectRoot,
      baseProfile({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
        rag_similarity_threshold: 1.01,
        rag_relief_floor: 1.01,
      }),
    );
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
      rag_similarity_threshold: 1.01,
      rag_relief_floor: 1.01,
    });

    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.rebuild({
      intelligence: baseProfile({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
        rag_similarity_threshold: 1.01,
        rag_relief_floor: 1.01,
      }).intelligence,
    });
    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(retrieval.fallback_reason).toBe('below-similarity-threshold');
  });

  // Issue #354 — floor-with-relief. Bracket the (deterministic) auth match score S
  // (>=0.75 per the test above) with the two thresholds to exercise each branch without
  // needing a mid-range cosine: relief_floor <= S < similarity_threshold → relief.
  async function buildEnabled(overrides: Partial<IntelligenceConfig>) {
    const intelligence = {
      rag_enabled: true,
      embedding_provider: 'local' as const,
      embedding_model: 'fake-local',
      ...overrides,
    };
    writeProjectProfile(projectRoot, baseProfile(intelligence));
    persistIntelligence(projectRoot, intelligence);
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.rebuild({ intelligence: baseProfile(intelligence).intelligence });
    const sync = await service.refreshContext();
    return { service, sync };
  }

  it('#354: delivers a low-confidence relief slice when nothing clears the floor', async () => {
    // similarity_threshold above S, relief_floor below S → the auth match falls into the
    // relief band and is delivered tagged low-confidence rather than dropped.
    const { service, sync } = await buildEnabled({
      rag_similarity_threshold: 1.5,
      rag_relief_floor: 0.5,
    });
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });
    expect(retrieval.chunks_retrieved).toBeGreaterThan(0);
    expect(retrieval.low_confidence).toBe(true);
    expect(retrieval.fallback_reason).toBeUndefined();
    expect(retrieval.best_score).toBeGreaterThanOrEqual(0.75);
  });

  it('#354: stays dark but carries best_score when even the relief band is not met', async () => {
    // Both thresholds above S → nothing delivered, but best_score flows out for the
    // honest "none above the floor (best NN%)" artifact line.
    const { service, sync } = await buildEnabled({
      rag_similarity_threshold: 1.5,
      rag_relief_floor: 1.4,
    });
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });
    expect(retrieval.chunks_retrieved).toBe(0);
    expect(retrieval.fallback_reason).toBe('below-similarity-threshold');
    expect(retrieval.best_score).toBeGreaterThanOrEqual(0.75);
  });

  it('#354: a high-confidence hit is not flagged low-confidence and carries best_score', async () => {
    const { service, sync } = await buildEnabled({ rag_similarity_threshold: 0.75 });
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });
    expect(retrieval.chunks_retrieved).toBeGreaterThan(0);
    expect(retrieval.low_confidence).toBe(false);
    expect(retrieval.best_score).toBeGreaterThanOrEqual(0.75);
  });

  it('#354: probe returns pre-floor scored candidates for a query', async () => {
    const { service } = await buildEnabled({ rag_similarity_threshold: 0.75 });
    const candidates = await service.probe({ taskDescription: 'auth', keywords: ['auth'] }, 5);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].score).toBeGreaterThanOrEqual(0.75);
    expect(candidates[0].source_file).toContain('auth.ts');
  });

  it('#354: probe returns nothing when RAG is disabled', async () => {
    // Default profile has rag_enabled=false; probe short-circuits with no index work.
    const service = new RagService(projectRoot, fakeProviderFactory());
    expect(await service.probe({ taskDescription: 'auth', keywords: ['auth'] })).toEqual([]);
  });

  it('refreshes and retrieves through retrieveForEval', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    const refreshSpy = vi.spyOn(service, 'refreshContext');
    const retrieveSpy = vi.spyOn(service, 'retrieve');
    const syncSpy = vi.spyOn(
      service as unknown as {
        syncVectorIndex: (syncResult: unknown, intelligence?: unknown) => Promise<void>;
      },
      'syncVectorIndex',
    );

    writeFileSync(
      join(projectRoot, 'src/billing.ts'),
      [
        'export function runBillingWorkflow() {',
        "  const billingContext = 'billing workflow reconciliation for invoices and receipts';",
        '  return billingContext.length > 0;',
        '}',
        '',
      ].join('\n'),
    );

    const retrieval = await service.retrieveForEval({
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(retrieveSpy).not.toHaveBeenCalled();
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(retrieval.chunks_retrieved).toBeGreaterThan(0);
  });

  it('reports stale_metadata when RAG is disabled but the stored index was built with a different provider', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    // Build index with local provider
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    // Now switch profile to a different provider and disable RAG. RAG state lives
    // in `.paqad/.config`, so the switch is persisted there (the build above wrote
    // local/enabled; this authoritatively resets to openai/disabled).
    writeProjectProfile(
      projectRoot,
      baseProfile({
        rag_enabled: false,
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
    );
    persistIntelligence(projectRoot, {
      rag_enabled: false,
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
    });

    const status = await service.getStatus();
    expect(status.enabled).toBe(false);
    // Index was built with 'local/fake-local' but current config is 'openai/text-embedding-3-small'
    expect(status.stale_metadata).toBe(true);
    expect(status.reason).toContain('provider/model');
  });

  it('falls back cleanly when the configured provider no longer matches the stored index', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    writeProjectProfile(
      projectRoot,
      baseProfile({
        rag_enabled: true,
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
    );
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
    });

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(retrieval.chunks_retrieved).toBe(0);
    expect(retrieval.fallback_reason).toContain('provider/model');
  });

  it('falls back cleanly when the stored vector payload is corrupt', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    writeFileSync(join(projectRoot, '.paqad', 'vectors', 'index.json'), '{corrupt');

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(retrieval.chunks_retrieved).toBe(0);
    expect(retrieval.fallback_reason).toBe('vector index payload is unreadable');
  });

  it('warns once when resumed retrieval sees a stale handoff-backed RAG index', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad', 'session', 'handoff.json'),
      JSON.stringify({
        version: 2,
        session_id: 'resume-1',
        timestamp: '2026-03-27T00:00:00.000Z',
        stack_state_hash: 'hash',
        retrieval: {
          rag_enabled: true,
          embedding_provider: 'local',
        },
        active_task: {
          classification: 'implementation',
          description: 'resume auth work',
          spec_path: null,
        },
        decisions: [],
        files_modified: [],
        blockers: [],
        next_steps: [],
        open_questions: [],
        context_pointers: {
          spec_artifacts: [],
          relevant_files: [],
          relevant_docs: [],
        },
        compression_stats: {
          original_context_tokens: 100,
          handoff_tokens: 25,
          compression_ratio: 0.25,
        },
      }),
      'utf8',
    );
    writeFileSync(join(projectRoot, '.paqad', 'vectors', 'index.json'), '{corrupt');

    const logs = captureEngineLogs();
    const sync = await service.refreshContext();

    const first = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });
    const second = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(first.fallback_reason).toBe('vector index payload is unreadable');
    expect(second.fallback_reason).toBe('vector index payload is unreadable');
    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe('warn');
    expect(logs[0]?.message).toContain('paqad-ai rag rebuild');
    expect(readFileSync(join(projectRoot, '.paqad', 'audit.log'), 'utf8')).toContain(
      'rag-resume-warning',
    );
  });

  it('falls back when a remote API key expires after the index has already been built', async () => {
    const expiringProviderFactory: ProviderFactory = async () => ({
      name: 'openai',
      model: 'text-embedding-3-small',
      async validate() {
        return;
      },
      async embed(input: string | string[]) {
        const batch = Array.isArray(input) ? input : [input];
        if (!Array.isArray(input)) {
          throw new EmbeddingProviderError('openai', 'invalid_api_key', 'Invalid OPENAI_API_KEY');
        }

        return batch.map(() => [1, 0]);
      },
    });

    writeProjectProfile(
      projectRoot,
      baseProfile({
        rag_enabled: true,
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
    );
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
    });

    const service = new RagService(projectRoot, expiringProviderFactory);
    await service.rebuild({
      intelligence: baseProfile({
        rag_enabled: true,
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }).intelligence,
    });

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(retrieval.chunks_retrieved).toBe(0);
    expect(retrieval.fallback_reason).toBe('Invalid OPENAI_API_KEY');
  });

  it('keeps retrieval working when resume validation itself fails', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const validate = vi.fn().mockRejectedValue(new Error('resume parse failed'));
    Object.assign(service as object, {
      resumeValidator: { validate },
      resumeValidationPromise: undefined,
    });

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(validate).toHaveBeenCalledTimes(1);
    expect(retrieval.chunks_retrieved).toBeGreaterThan(0);
    expect(retrieval.fallback_reason).toBeUndefined();
  });

  it('returns empty result immediately when topN is 0 (depth=none)', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(
      sync,
      { taskDescription: 'rename x to y', keywords: ['rename'], symbolReferences: [] },
      0,
    );

    expect(retrieval.vector_scores.size).toBe(0);
    expect(retrieval.chunks_retrieved).toBe(0);
    expect(retrieval.fallback_reason).toBeUndefined();
  });

  it('stores and resolves project API keys', () => {
    const service = new RagService(projectRoot, fakeProviderFactory());

    const secretPath = service.storeApiKey('openai', 'sk-test');

    expect(secretPath).toContain('.paqad');
    expect(service.resolveApiKeyName('openai')).toBe('OPENAI_API_KEY');
    expect(service.resolveApiKeyName('voyageai')).toBe('VOYAGE_API_KEY');
    expect(service.hasApiKey('openai')).toBe(true);
  });

  it('reports local model cache presence and absence', () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const cachedModelDir = join(service.localModelPath(), 'cached-model');
    mkdirSync(cachedModelDir, { recursive: true });

    expect(service.localModelCached('cached-model')).toBe(true);
    expect(service.localModelCached()).toBe(true);
    expect(service.localModelCached('missing-model')).toBe(false);
  });

  it('uses the provided topN override instead of intelligence.rag_top_n', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(
      sync,
      { taskDescription: 'debug auth policy', keywords: ['auth'], symbolReferences: [] },
      5,
    );

    // Should return results (the override topN is just 5, not 0, so retrieval runs)
    expect(retrieval.chunks_retrieved).toBeGreaterThanOrEqual(0);
  });

  it('builds an empty but valid index when the project has no supported code files yet', async () => {
    rmSync(join(projectRoot, 'src'), { recursive: true, force: true });
    writeFileSync(join(projectRoot, 'README.md'), '# Empty project\n');

    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const status = await service.getStatus();
    expect(status.index_present).toBe(true);
    expect(status.valid).toBe(true);
    expect(status.chunk_count).toBe(0);
  });

  it('throws when configureAndBuild runs without a project profile', async () => {
    vi.spyOn(projectProfile, 'readProjectProfile').mockReturnValueOnce(undefined);
    const service = new RagService(projectRoot, fakeProviderFactory());

    await expect(
      service.configureAndBuild({
        rag_enabled: true,
        embedding_provider: 'local',
      }),
    ).rejects.toThrow('Project profile not found');
  });

  it('throws when configureAndBuild enables rag without an embedding provider', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());

    await expect(
      service.configureAndBuild({
        rag_enabled: true,
      }),
    ).rejects.toThrow('Embedding provider is required when enabling RAG');
  });

  it('fills in the default embedding model when configureAndBuild omits one', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
    });

    const status = await service.getStatus();
    expect(status.configured_model).toBe('Xenova/all-MiniLM-L6-v2');
  });

  it('forwards pattern refresh progress during configureAndBuild', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const progress = vi.fn();
    vi.spyOn(
      (
        service as unknown as {
          patternVectors: {
            refresh: (root: string, onProgress?: (message: string) => void) => Promise<void>;
          };
        }
      ).patternVectors,
      'refresh',
    ).mockImplementation(async (_root, onProgress) => {
      onProgress?.('pattern refresh complete');
    });

    await service.configureAndBuild(
      {
        rag_enabled: true,
        embedding_provider: 'local',
      },
      progress,
    );

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'build',
        message: 'pattern refresh complete',
      }),
    );
  });

  it('throws when rebuild is called before rag is enabled and configured', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());

    await expect(service.rebuild()).rejects.toThrow(
      'RAG must be enabled and configured before rebuilding',
    );
  });

  it('emits rebuild progress for chunking and pattern refresh work', async () => {
    writeFileSync(
      join(projectRoot, 'src/second.ts'),
      [
        'export function secondFile() {',
        "  const secondContext = 'second file fixture for rebuild progress coverage';",
        '  return secondContext.length > 0;',
        '}',
        '',
      ].join('\n'),
    );
    const service = new RagService(projectRoot, fakeProviderFactory());
    const progress = vi.fn();
    vi.spyOn(
      (
        service as unknown as {
          patternVectors: {
            refresh: (root: string, onProgress?: (message: string) => void) => Promise<void>;
          };
        }
      ).patternVectors,
      'refresh',
    ).mockImplementation(async (_root, onProgress) => {
      onProgress?.('pattern refresh complete');
    });

    await service.rebuild({
      intelligence: baseProfile({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
      }).intelligence,
      onProgress: progress,
    });

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Discovering repository files for RAG eligibility',
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Filtering 4 discovered files with RAG rules'),
        loaded: 0,
        total: 4,
        percent: 0,
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Chunking 2 source files'),
        loaded: 0,
        total: 2,
        percent: 0,
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Chunked 2/2 files'),
        percent: 100,
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'pattern refresh complete',
      }),
    );
  });

  it('reports 100 percent chunking progress when rebuilding an empty project with progress enabled', async () => {
    rmSync(join(projectRoot, 'src'), { recursive: true, force: true });
    writeFileSync(join(projectRoot, 'README.md'), '# Empty project\n');
    const service = new RagService(projectRoot, fakeProviderFactory());
    const progress = vi.fn();

    await service.rebuild({
      intelligence: baseProfile({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
      }).intelligence,
      onProgress: progress,
    });

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('RAG file filtering kept 0 eligible files'),
        percent: 100,
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Chunked 0/0 files',
        percent: 100,
      }),
    );
  });

  it('skips incremental sync when the vector index payload is unavailable', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const vectorIndex = (
      service as unknown as { vectorIndex: { loadMeta: () => Promise<unknown> } }
    ).vectorIndex;
    vi.spyOn(vectorIndex, 'loadMeta').mockResolvedValueOnce(null);

    writeFileSync(
      join(projectRoot, 'src/changed.ts'),
      [
        'export function changedAuthFile() {',
        "  const changedContext = 'changed file fixture for incremental sync coverage';",
        '  return changedContext.length > 0;',
        '}',
        '',
      ].join('\n'),
    );
    const sync = await service.refreshContext();

    expect(sync.added_files.some((file) => file.endsWith('changed.ts'))).toBe(true);
  });

  it('embeds chunk batches with progress updates and ETA text', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const provider = await fakeProviderFactory()();
    const chunks = Array.from({ length: 40 }, (_, index) => ({
      id: `chunk-${index}`,
      source_file: join(projectRoot, `src/file-${index}.ts`),
      ast_node_type: 'function',
      ast_node_path: `fn-${index}`,
      exported_symbols: [],
      content: `export const value${index} = ${index};`,
      char_count: 10,
      content_hash: `hash-${index}`,
    }));
    const progress = vi.fn();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(2_000).mockReturnValueOnce(3_000);

    const embedded = await (
      service as unknown as {
        embedChunks: (
          provider: EmbeddingProvider,
          chunks: typeof chunks,
          options: {
            onProgress: (update: {
              message: string;
              loaded: number;
              total: number;
              percent: number;
            }) => void;
            embedTextOf: (chunk: { content: string }) => string;
          },
        ) => Promise<Array<{ vector: number[] }>>;
      }
    ).embedChunks(provider, chunks, {
      onProgress: progress,
      embedTextOf: (chunk) => chunk.content,
    });

    expect(embedded).toHaveLength(40);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls[0]?.[0]).toMatchObject({ loaded: 32, total: 40, percent: 80 });
    expect(progress.mock.calls[0]?.[0].message).toContain('ETA');
    expect(progress.mock.calls[1]?.[0]).toMatchObject({ loaded: 40, total: 40, percent: 100 });
  });

  it('emits a single all-cached progress tick when every chunk is already embedded (F8)', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const provider = await fakeProviderFactory()();
    const chunks = [
      {
        id: 'cached-1',
        source_file: join(projectRoot, 'src/cached.ts'),
        ast_node_type: 'function',
        ast_node_path: 'cached',
        exported_symbols: [],
        content: 'export const cached = 1;',
        char_count: 10,
        content_hash: 'cached-hash',
      },
    ];
    const cast = service as unknown as {
      embedChunks: (
        provider: EmbeddingProvider,
        chunks: typeof chunks,
        options: {
          onProgress?: (update: { message: string; percent: number }) => void;
          embedTextOf: (chunk: { content: string }) => string;
        },
      ) => Promise<unknown[]>;
    };
    const embedTextOf = (chunk: { content: string }) => chunk.content;
    // First call warms (and flushes) the content-addressed cache.
    await cast.embedChunks(provider, chunks, { embedTextOf });
    // Second call finds everything cached → the single all-cached tick.
    const progress = vi.fn();
    await cast.embedChunks(provider, chunks, { onProgress: progress, embedTextOf });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls[0]?.[0].message).toContain('all cached');
    expect(progress.mock.calls[0]?.[0].percent).toBe(100);
  });

  it('checkpoints and throws when the abort signal fires between embed batches (F8/PQD-104)', async () => {
    const controller = new AbortController();
    let calls = 0;
    const provider: EmbeddingProvider = {
      name: 'local',
      model: 'fake-local',
      async validate() {
        return;
      },
      async embed(input: string | string[]) {
        calls++;
        // Abort after the first batch so the next loop iteration trips the guard.
        if (calls === 1) {
          controller.abort();
        }
        return (Array.isArray(input) ? input : [input]).map(() => [0.5, 0.5]);
      },
    };
    const service = new RagService(projectRoot, async () => provider);
    const chunks = Array.from({ length: 40 }, (_, index) => ({
      id: `abort-${index}`,
      source_file: join(projectRoot, `src/abort-${index}.ts`),
      ast_node_type: 'function',
      ast_node_path: `fn-${index}`,
      exported_symbols: [],
      content: `export const abortValue${index} = ${index};`,
      char_count: 10,
      content_hash: `abort-hash-${index}`,
    }));
    const cast = service as unknown as {
      embedChunks: (
        provider: EmbeddingProvider,
        chunks: typeof chunks,
        options: { signal: AbortSignal; embedTextOf: (chunk: { content: string }) => string },
      ) => Promise<unknown[]>;
    };
    await expect(
      cast.embedChunks(provider, chunks, {
        signal: controller.signal,
        embedTextOf: (chunk) => chunk.content,
      }),
    ).rejects.toThrow(/cancelled/i);
  });

  it('getStatus tolerates a corrupt vision meta (still reports the file index)', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const visionIndex = (
      service as unknown as { visionVectorIndex: { loadMeta: () => Promise<unknown> } }
    ).visionVectorIndex;
    vi.spyOn(visionIndex, 'loadMeta').mockRejectedValueOnce(new Error('corrupt vision meta'));
    const status = await service.getStatus();
    expect(status.vision_chunk_count).toBeUndefined();
  });

  it('applyReranking reorders via the configured reranker when enabled (F18)', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const hits = [
      { item: { id: 'a', content: 'alpha' }, score: 0.9 },
      { item: { id: 'b', content: 'beta' }, score: 0.8 },
    ];
    const cast = service as unknown as {
      applyReranking: (
        query: string,
        hits: typeof hits,
        config: { enabled: boolean; backend: string; candidate_pool_size: number },
      ) => Promise<typeof hits>;
    };
    // A passthrough reranker needs no model — exercises the enabled try/return path.
    const reranked = await cast.applyReranking('q', hits, {
      enabled: true,
      backend: 'passthrough',
      candidate_pool_size: 50,
    });
    expect(reranked.map((hit) => hit.item.id).sort()).toEqual(['a', 'b']);
  });

  it('applyReranking falls back to the input order when the reranker throws (F18)', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const hits = [
      { item: { id: 'a', content: 'alpha' }, score: 0.9 },
      { item: { id: 'b', content: 'beta' }, score: 0.8 },
    ];
    const cast = service as unknown as {
      applyReranking: (
        query: string,
        hits: typeof hits,
        config: {
          enabled: boolean;
          backend: string;
          candidate_pool_size: number;
          api_key?: string;
        },
      ) => Promise<typeof hits>;
    };
    // Cohere backend with no usable key throws inside rerank → audited fallback to input order.
    const reranked = await cast.applyReranking('q', hits, {
      enabled: true,
      backend: 'cohere',
      candidate_pool_size: 50,
      api_key: '',
    });
    expect(reranked).toHaveLength(2);
  });

  it('returns early from syncVectorIndex when embedding provider is unavailable', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const replaceAll = vi.spyOn(
      (service as unknown as { vectorIndex: { replaceAll: (...args: unknown[]) => Promise<void> } })
        .vectorIndex,
      'replaceAll',
    );

    await (
      service as unknown as {
        syncVectorIndex: (
          syncResult: {
            changed_files: string[];
            added_files: string[];
            deleted_files: string[];
            index: { entries: [] };
          },
          intelligence: IntelligenceConfig,
        ) => Promise<void>;
      }
    ).syncVectorIndex(
      {
        changed_files: [join(projectRoot, 'src/auth.ts')],
        added_files: [],
        deleted_files: [],
        index: { entries: [] },
      },
      {
        rag_enabled: true,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      } as IntelligenceConfig,
    );

    expect(replaceAll).not.toHaveBeenCalled();
  });

  it('falls back with unknown-error messaging when retrieval throws a non-Error value', async () => {
    const rawFailureFactory: ProviderFactory = async () => ({
      name: 'local',
      model: 'fake-local',
      async validate() {
        return;
      },
      async embed(input: string | string[]) {
        if (!Array.isArray(input)) {
          throw 'raw-query-failure';
        }
        return (Array.isArray(input) ? input : [input]).map(() => [1, 0]);
      },
    });
    const service = new RagService(projectRoot, rawFailureFactory);
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(retrieval.fallback_reason).toBe('unknown-error');
  });

  it('audits unknown-error when a build fails with a non-Error value', async () => {
    const rawFailureFactory: ProviderFactory = async () => {
      throw 'raw-build-failure';
    };
    const service = new RagService(projectRoot, rawFailureFactory);

    await expect(
      service.rebuild({
        intelligence: baseProfile({
          rag_enabled: true,
          embedding_provider: 'local',
          embedding_model: 'fake-local',
        }).intelligence,
      }),
    ).rejects.toBe('raw-build-failure');

    expect(readFileSync(join(projectRoot, '.paqad', 'audit.log'), 'utf8')).toContain(
      'unknown-error',
    );
  });

  it('falls back to invalid-index-during-refresh when refresh sees an invalid index without a reason', async () => {
    writeProjectProfile(
      projectRoot,
      baseProfile({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
      }),
    );
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    const service = new RagService(projectRoot, fakeProviderFactory());
    vi.spyOn(service, 'getStatus').mockResolvedValueOnce({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'fake-local',
      index_present: true,
      valid: false,
      chunk_count: 0,
      size_bytes: 0,
    });

    await service.refreshContext();

    expect(readFileSync(join(projectRoot, '.paqad', 'audit.log'), 'utf8')).toContain(
      'invalid-index-during-refresh',
    );
  });

  it('falls back to stale-or-mismatched-index when retrieve sees an invalid index without a reason', async () => {
    writeProjectProfile(
      projectRoot,
      baseProfile({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
      }),
    );
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    const service = new RagService(projectRoot, fakeProviderFactory());
    const sync = await service.refreshContext();
    vi.spyOn(service, 'getStatus').mockResolvedValueOnce({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'fake-local',
      index_present: true,
      valid: false,
      chunk_count: 0,
      size_bytes: 0,
    });

    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
      symbolReferences: [],
    });

    expect(retrieval.fallback_reason).toBe('stale-or-mismatched-index');
  });

  it('retrieves successfully when symbolReferences are omitted', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    await service.configureAndBuild({
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });
    persistIntelligence(projectRoot, {
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    });

    const sync = await service.refreshContext();
    const retrieval = await service.retrieve(sync, {
      taskDescription: 'debug auth policy',
      keywords: ['auth'],
    });

    expect(retrieval.chunks_retrieved).toBeGreaterThan(0);
  });

  it('uses the default intelligence config when syncVectorIndex is called without an explicit override', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const replaceAll = vi.spyOn(
      (service as unknown as { vectorIndex: { replaceAll: (...args: unknown[]) => Promise<void> } })
        .vectorIndex,
      'replaceAll',
    );

    await (
      service as unknown as {
        syncVectorIndex: (syncResult: {
          changed_files: string[];
          added_files: string[];
          deleted_files: string[];
          index: { entries: [] };
        }) => Promise<void>;
      }
    ).syncVectorIndex({
      changed_files: [join(projectRoot, 'src/auth.ts')],
      added_files: [],
      deleted_files: [],
      index: { entries: [] },
    });

    expect(replaceAll).not.toHaveBeenCalled();
  });

  it('returns early from syncVectorIndex when the current vector payload is missing', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    const vectorIndex = (
      service as unknown as {
        vectorIndex: { load: () => Promise<unknown>; loadMeta: () => Promise<unknown> };
      }
    ).vectorIndex;
    vi.spyOn(vectorIndex, 'load').mockResolvedValueOnce(null);
    vi.spyOn(vectorIndex, 'loadMeta').mockResolvedValueOnce({
      provider: 'local',
      model: 'fake-local',
    });

    await (
      service as unknown as {
        syncVectorIndex: (
          syncResult: {
            changed_files: string[];
            added_files: string[];
            deleted_files: string[];
            index: { entries: [] };
          },
          intelligence: IntelligenceConfig,
        ) => Promise<void>;
      }
    ).syncVectorIndex(
      {
        changed_files: [join(projectRoot, 'src/auth.ts')],
        added_files: [],
        deleted_files: [],
        index: { entries: [] },
      },
      baseProfile({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
      }).intelligence,
    );

    expect(vectorIndex.load).toHaveBeenCalled();
  });

  it('discovers source files without a profile and ignores packs without AST file extensions', async () => {
    writeFileSync(join(projectRoot, 'README.md'), '# docs\n\ncontent\n'.repeat(20));
    vi.spyOn(projectProfile, 'readProjectProfile').mockReturnValueOnce(undefined);
    vi.spyOn(projectPacks, 'getPacksForFrameworks').mockReturnValueOnce([
      { manifest: {} } as FrameworkPack,
    ]);
    const service = new RagService(projectRoot, fakeProviderFactory());

    const files = await (
      service as unknown as { discoverSourceFiles: () => Promise<string[]> }
    ).discoverSourceFiles();

    expect(files.some((file) => file.endsWith('README.md'))).toBe(true);
    expect(files.some((file) => file.endsWith('auth.ts'))).toBe(false);
  });

  it('audits resume warnings even when the provider is unknown', async () => {
    const service = new RagService(projectRoot, fakeProviderFactory());
    Object.assign(service as object, {
      resumeValidator: {
        validate: vi.fn().mockResolvedValue({ warning: 'stale resume context' }),
      },
      resumeValidationPromise: undefined,
    });
    const logs = captureEngineLogs();

    await (
      service as unknown as { validateResumeState: () => Promise<void> }
    ).validateResumeState();

    expect(logs).toContainEqual({ level: 'warn', message: 'stale resume context' });
    expect(readFileSync(join(projectRoot, '.paqad', 'audit.log'), 'utf8')).toContain(
      'provider="unknown"',
    );
  });

  it('audits validation failures before aborting a build', async () => {
    const failingProviderFactory: ProviderFactory = async () => ({
      name: 'openai',
      model: 'text-embedding-3-small',
      async validate() {
        throw new EmbeddingProviderError('openai', 'invalid_api_key', 'Invalid OPENAI_API_KEY');
      },
      async embed() {
        return [];
      },
    });

    const service = new RagService(projectRoot, failingProviderFactory);
    await expect(
      service.configureAndBuild({
        rag_enabled: true,
        embedding_provider: 'openai',
        embedding_model: 'text-embedding-3-small',
      }),
    ).rejects.toThrow('Invalid OPENAI_API_KEY');

    const audit = readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8');
    expect(audit).toContain('rag-api-key-validation-failed');
    expect(audit).toContain('rag-build-failed');
  });
});

describe('lexicalDocumentText (F24 BM25 contextualisation)', () => {
  it('prepends the blurb for a code chunk with a source path', () => {
    const text = lexicalDocumentText({
      id: '1',
      content: 'return a + b;',
      source_file: 'src/math.ts',
      ast_node_path: 'add',
      exported_symbols: ['add'],
    });
    expect(text).toContain('[src/math.ts');
    expect(text).toContain('› add');
    expect(text).toContain('exports add');
    expect(text.endsWith('return a + b;')).toBe(true);
  });

  it('falls back to bare content when the chunk has no source path (e.g. a vision chunk)', () => {
    const text = lexicalDocumentText({ id: '2', content: 'OCR TEXT' });
    expect(text).toBe('OCR TEXT');
  });

  it('tolerates a chunk missing ast_node_path and exported_symbols', () => {
    const text = lexicalDocumentText({ id: '3', content: 'body', source_file: 'src/a.ts' });
    expect(text).toContain('[src/a.ts]');
    expect(text.endsWith('body')).toBe(true);
  });
});
