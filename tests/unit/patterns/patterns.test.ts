import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

import type { Pattern } from '@/patterns/index.js';
import type { EmbeddingProvider } from '@/rag/types.js';

async function importPatternModules(homeDir: string) {
  vi.resetModules();
  vi.stubEnv('HOME', homeDir);
  // os.homedir() reads USERPROFILE on Windows — stub both or the fake home
  // is ignored there and pattern state leaks into the runner's real home.
  vi.stubEnv('USERPROFILE', homeDir);
  const [
    {
      PatternStore,
      PatternCli,
      PatternRecorder,
      PatternSuggester,
      PatternVectorService,
      getGlobalPatternVectorPaths,
      suggestPatternsForProject,
    },
  ] = await Promise.all([import('@/patterns/index.js')]);

  return {
    PatternStore,
    PatternCli,
    PatternRecorder,
    PatternSuggester,
    PatternVectorService,
    getGlobalPatternVectorPaths,
    suggestPatternsForProject,
  };
}

function makePattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: 'pattern-1',
    created_at: '2024-01-01T00:00:00.000Z',
    source_project: 'demo',
    stack_filter: {
      domain: 'coding',
      frameworks: ['react', 'next'],
      traits: ['tailwind'],
    },
    category: 'bugfix',
    problem: 'Fix a flaky React rendering issue in a long running list view.',
    solution: 'Stabilize the async boundary and add a regression test.',
    files_involved: ['src/app.ts'],
    verification: { tests_passed: true, build_passed: true },
    tags: ['react', 'rendering'],
    ...overrides,
  };
}

describe('patterns', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'paqad-patterns-home-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('stores, filters, updates, and deletes patterns from the global index', async () => {
    const { PatternStore } = await importPatternModules(homeDir);
    const store = new PatternStore();
    const first = makePattern();
    const second = makePattern({
      id: 'pattern-2',
      category: 'performance',
      stack_filter: { domain: 'coding', frameworks: ['vue'], traits: [] },
      tags: ['cache'],
      problem: 'Cache hot routes to reduce latency in the dashboard view.',
    });

    await store.save(first);
    await store.save(second);

    expect(await store.load('pattern-1')).toEqual(first);
    expect(await store.load('missing')).toBeNull();

    const updated = makePattern({ problem: 'Updated problem text for the same pattern id.' });
    await store.save(updated);

    const index = JSON.parse(readFileSync(store.indexPath, 'utf8'));
    expect(index.entries).toHaveLength(2);
    expect(index.entries[0].problem_preview).toBe(updated.problem.slice(0, 100));

    await expect(
      store.list({
        domain: 'coding',
        frameworks: ['react'],
        category: 'bugfix',
        keywords: ['rendering'],
      }),
    ).resolves.toEqual([updated]);

    await expect(store.list({ frameworks: ['svelte'] })).resolves.toEqual([]);

    await store.delete('pattern-1');
    await expect(store.list()).resolves.toEqual([second]);
    await store.delete('missing');
  });

  it('does not drop an index entry when file deletion fails for reasons other than missing files', async () => {
    const originalFsPromises =
      await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const unlinkMock = vi.fn(originalFsPromises.unlink);
    vi.doMock('node:fs/promises', () => ({
      ...originalFsPromises,
      unlink: unlinkMock,
    }));

    const { PatternStore } = await importPatternModules(homeDir);
    const store = new PatternStore();
    const pattern = makePattern();
    await store.save(pattern);

    const lockedFileError = Object.assign(new Error('permission denied'), {
      code: 'EACCES',
    }) as NodeJS.ErrnoException;
    unlinkMock.mockRejectedValueOnce(lockedFileError);

    await expect(store.delete(pattern.id)).rejects.toMatchObject({ code: 'EACCES' });
    expect(await store.load(pattern.id)).toEqual(pattern);
    await expect(store.list()).resolves.toEqual([pattern]);

    const index = JSON.parse(readFileSync(store.indexPath, 'utf8')) as {
      entries: Array<{ id: string }>;
    };
    expect(index.entries.map((entry) => entry.id)).toContain(pattern.id);
  });

  it('scores suggested patterns by frameworks, keywords, staleness, and limit', async () => {
    const { PatternSuggester } = await importPatternModules(homeDir);
    const list = vi.fn().mockResolvedValue([
      makePattern(),
      makePattern({
        id: 'pattern-2',
        created_at: '2020-01-01T00:00:00.000Z',
        problem: 'Improve React list rendering speed with virtualization.',
        tags: ['react', 'virtualization'],
      }),
      makePattern({
        id: 'pattern-3',
        stack_filter: { domain: 'coding', frameworks: ['laravel'], traits: [] },
        problem: 'Queue job retries fail under heavy load.',
        tags: ['queue'],
      }),
    ]);

    const suggester = new PatternSuggester({ list } as never, 0.4);
    const results = await suggester.suggest(['react', 'rendering'], 'coding', ['react'], 2);

    expect(list).toHaveBeenCalledWith({ domain: 'coding', frameworks: ['react'] });
    expect(results).toHaveLength(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    expect(results[1].is_stale).toBe(true);
  });

  it('ranks stale patterns below equally relevant fresh patterns', async () => {
    const { PatternSuggester } = await importPatternModules(homeDir);
    const fresh = makePattern({
      id: 'pattern-fresh',
      created_at: '2026-01-01T00:00:00.000Z',
      problem: 'Improve React list rendering speed with virtualization.',
      tags: ['react', 'virtualization'],
    });
    const stale = makePattern({
      id: 'pattern-stale',
      created_at: '2020-01-01T00:00:00.000Z',
      problem: 'Improve React list rendering speed with virtualization.',
      tags: ['react', 'virtualization'],
    });
    const list = vi.fn().mockResolvedValue([stale, fresh]);

    const suggester = new PatternSuggester({ list } as never, 0.1);
    const results = await suggester.suggest(['react', 'virtualization'], 'coding', ['react'], 2);

    expect(results.map((result) => result.pattern.id)).toEqual(['pattern-fresh', 'pattern-stale']);
    expect(results[0].is_stale).toBe(false);
    expect(results[1].is_stale).toBe(true);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('can blend semantic scores into pattern suggestions', async () => {
    const { PatternSuggester } = await importPatternModules(homeDir);
    const list = vi.fn().mockResolvedValue([
      makePattern(),
      makePattern({
        id: 'pattern-2',
        problem: 'Concurrent coupon redemption causes duplicate credits.',
        tags: ['race-condition'],
      }),
    ]);

    const suggester = new PatternSuggester({ list } as never, 0.1, async (pattern) =>
      pattern.id === 'pattern-2' ? 1 : 0,
    );
    const results = await suggester.suggest(['coupon'], 'coding', ['react'], 2);

    expect(results[0].pattern.id).toBe('pattern-2');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('builds and refreshes a global pattern vector index for project-aware suggestions', async () => {
    const { PatternStore, PatternVectorService, getGlobalPatternVectorPaths } =
      await importPatternModules(homeDir);
    const store = new PatternStore();
    await store.save(
      makePattern({
        id: 'pattern-auth',
        problem: 'Authorization gate checks miss policy coverage in admin flows.',
        tags: ['authorization', 'policy'],
      }),
    );
    await store.save(
      makePattern({
        id: 'pattern-billing',
        problem: 'Concurrent coupon redemption causes duplicate credits.',
        tags: ['billing', 'race-condition'],
      }),
    );

    const providerFactory = async () => ({
      name: 'local' as const,
      model: 'fake-local',
      async validate() {
        return;
      },
      async embed(input: string | string[]) {
        const batch = Array.isArray(input) ? input : [input];
        return batch.map((text) => {
          const lower = text.toLowerCase();
          if (lower.includes('coupon') || lower.includes('billing')) return [0, 1];
          if (lower.includes('auth') || lower.includes('authorization') || lower.includes('policy'))
            return [1, 0];
          return [0.5, 0.5];
        });
      },
    });

    const projectRoot = join(homeDir, 'project');
    const { writeProjectProfile } = await import('@/core/project-profile.js');
    writeProjectProfile(projectRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content', 'coding', 'security'],
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
      research: { depth: 'standard' },
      intelligence: {
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
      efficiency: { differential_refresh: true },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 1000,
      },
      custom: {
        classification_dimensions: [],
        verification_plugins: [],
        escalation_rules: [],
      },
    });

    const vectors = new PatternVectorService(store, providerFactory as never);
    const suggester = await vectors.createSuggester(projectRoot, 0.2);
    const results = await suggester.suggest(['coupon'], 'coding', ['react'], 2);

    expect(results[0]?.pattern.id).toBe('pattern-billing');
    const paths = getGlobalPatternVectorPaths('local', 'fake-local');
    expect(readFileSync(join(homeDir, paths.meta), 'utf8')).toContain('"provider": "local"');
  });

  it('scores filtered patterns semantically without losing them to a global top-n cutoff', async () => {
    const { PatternStore, PatternVectorService } = await importPatternModules(homeDir);
    const store = new PatternStore();
    await store.save(
      makePattern({
        id: 'pattern-target',
        problem: 'Authorization policy regression in the admin flow.',
        tags: ['authorization'],
      }),
    );
    for (let index = 0; index < 30; index++) {
      await store.save(
        makePattern({
          id: `other-${index}`,
          stack_filter: { domain: 'coding', frameworks: ['laravel'], traits: [] },
          problem: `Authorization pattern ${index} for another framework`,
          tags: ['authorization'],
        }),
      );
    }

    const embed = vi.fn(async (input: string | string[]) => {
      const batch = Array.isArray(input) ? input : [input];
      return batch.map((text) => {
        const lower = text.toLowerCase();
        return lower.includes('authorization') ? [1, 0] : [0, 1];
      });
    });
    const providerFactory = async () => ({
      name: 'local' as const,
      model: 'fake-local',
      async validate() {
        return;
      },
      embed,
    });

    const projectRoot = join(homeDir, 'project-top-n');
    const { writeProjectProfile } = await import('@/core/project-profile.js');
    writeProjectProfile(projectRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content', 'coding', 'security'],
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
      research: { depth: 'standard' },
      intelligence: {
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
        rag_similarity_threshold: 0.75,
        rag_top_n: 3,
      },
      efficiency: { differential_refresh: true },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 1000,
      },
      custom: {
        classification_dimensions: [],
        verification_plugins: [],
        escalation_rules: [],
      },
    });

    const vectors = new PatternVectorService(store, providerFactory as never);
    const suggester = await vectors.createSuggester(projectRoot, 0.2);
    const results = await suggester.suggest(['authorization'], 'coding', ['react'], 3);

    expect(results.some((result) => result.pattern.id === 'pattern-target')).toBe(true);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('reports invalid vector metadata and rebuilds when refresh encounters a missing load result', async () => {
    const { PatternStore, PatternVectorService, getGlobalPatternVectorPaths } =
      await importPatternModules(homeDir);
    const store = new PatternStore();
    await store.save(
      makePattern({
        id: 'pattern-auth',
        problem: 'Authorization policy regression in the admin flow.',
        tags: ['authorization'],
      }),
    );

    const providerFactory = async () => ({
      name: 'local' as const,
      model: 'fake-local',
      async validate() {
        return;
      },
      async embed(input: string | string[]) {
        const batch = Array.isArray(input) ? input : [input];
        return batch.map(() => [1, 0]);
      },
    });

    const projectRoot = join(homeDir, 'project-invalid-meta');
    const { writeProjectProfile } = await import('@/core/project-profile.js');
    writeProjectProfile(projectRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content', 'coding', 'security'],
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
      research: { depth: 'standard' },
      intelligence: {
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'expected-model',
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
      efficiency: { differential_refresh: true },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 1000,
      },
      custom: {
        classification_dimensions: [],
        verification_plugins: [],
        escalation_rules: [],
      },
    });

    const vectors = new PatternVectorService(store, providerFactory as never);
    await vectors.rebuild(projectRoot);

    const metaPath = join(homeDir, getGlobalPatternVectorPaths('local', 'expected-model').meta);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { model: string };
    meta.model = 'different-model';
    writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    const status = await vectors.getStatus(projectRoot);
    expect(status.present).toBe(true);
    expect(status.valid).toBe(false);
    expect(status.reason).toContain('metadata does not match');

    const { FileVectorIndex } = await import('@/rag/vector-index.js');
    const loadSpy = vi.spyOn(FileVectorIndex.prototype, 'load').mockResolvedValueOnce(null);

    await vectors.refresh(projectRoot);
    expect(loadSpy).toHaveBeenCalled();
    loadSpy.mockRestore();
  });

  it('validates the provider before incremental refresh loads or rewrites the index', async () => {
    const { PatternStore, PatternVectorService } = await importPatternModules(homeDir);
    const store = new PatternStore();
    await store.save(
      makePattern({
        id: 'pattern-auth',
        problem: 'Authorization policy regression in the admin flow.',
        tags: ['authorization'],
      }),
    );

    const providerFactory = vi
      .fn<() => Promise<EmbeddingProvider>>()
      .mockResolvedValueOnce({
        name: 'local',
        model: 'fake-local',
        async validate() {
          return;
        },
        async embed(input: string | string[]) {
          const batch = Array.isArray(input) ? input : [input];
          return batch.map(() => [1, 0]);
        },
      })
      .mockResolvedValueOnce({
        name: 'local',
        model: 'fake-local',
        async validate() {
          throw new Error('provider validation failed');
        },
        async embed(input: string | string[]) {
          const batch = Array.isArray(input) ? input : [input];
          return batch.map(() => [1, 0]);
        },
      });

    const projectRoot = join(homeDir, 'project-refresh-validation');
    const { writeProjectProfile } = await import('@/core/project-profile.js');
    writeProjectProfile(projectRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content', 'coding', 'security'],
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
      research: { depth: 'standard' },
      intelligence: {
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
      efficiency: { differential_refresh: true },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 1000,
      },
      custom: {
        classification_dimensions: [],
        verification_plugins: [],
        escalation_rules: [],
      },
    });

    const vectors = new PatternVectorService(store, providerFactory);
    await vectors.rebuild(projectRoot);

    const { FileVectorIndex } = await import('@/rag/vector-index.js');
    const loadSpy = vi.spyOn(FileVectorIndex.prototype, 'load');
    const replaceAllSpy = vi.spyOn(FileVectorIndex.prototype, 'replaceAll');

    await expect(vectors.refresh(projectRoot)).rejects.toThrow('provider validation failed');
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(replaceAllSpy).not.toHaveBeenCalled();

    loadSpy.mockRestore();
    replaceAllSpy.mockRestore();
  });

  it('keeps separate global pattern indexes for different embedding models', async () => {
    const { PatternStore, PatternVectorService, getGlobalPatternVectorPaths } =
      await importPatternModules(homeDir);
    const store = new PatternStore();
    await store.save(
      makePattern({
        id: 'pattern-shared',
        problem: 'Shared authorization bug pattern.',
        tags: ['authorization'],
      }),
    );

    const providerFactory = async (
      _projectRoot: string,
      intelligence: { embedding_model?: string; embedding_provider: 'local' },
    ) => ({
      name: 'local' as const,
      model: intelligence.embedding_model ?? 'default-model',
      async validate() {
        return;
      },
      async embed(input: string | string[]) {
        const batch = Array.isArray(input) ? input : [input];
        return batch.map(() => [1, 0]);
      },
    });

    const { writeProjectProfile } = await import('@/core/project-profile.js');
    const projectAlpha = join(homeDir, 'project-alpha');
    const projectBeta = join(homeDir, 'project-beta');
    for (const [projectRoot, model] of [
      [projectAlpha, 'model-alpha'],
      [projectBeta, 'model-beta'],
    ] as const) {
      writeProjectProfile(projectRoot, {
        project: { name: 'Demo', id: 'demo', description: 'Demo' },
        active_capabilities: ['content', 'coding', 'security'],
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
        research: { depth: 'standard' },
        intelligence: {
          rag_enabled: true,
          embedding_provider: 'local',
          embedding_model: model,
          rag_similarity_threshold: 0.75,
          rag_top_n: 20,
        },
        efficiency: { differential_refresh: true },
        escalation: {
          destructive_operations: 'block',
          risky_migrations: 'warn',
          security_findings: 'block',
          db_row_threshold: 1000,
        },
        custom: {
          classification_dimensions: [],
          verification_plugins: [],
          escalation_rules: [],
        },
      });
    }

    const vectors = new PatternVectorService(store, providerFactory as never);
    await vectors.rebuild(projectAlpha);
    await vectors.rebuild(projectBeta);

    const alphaStatus = await vectors.getStatus(projectAlpha);
    const betaStatus = await vectors.getStatus(projectBeta);
    expect(alphaStatus).toMatchObject({ present: true, valid: true, chunk_count: 1 });
    expect(betaStatus).toMatchObject({ present: true, valid: true, chunk_count: 1 });

    const alphaMetaPath = join(homeDir, getGlobalPatternVectorPaths('local', 'model-alpha').meta);
    const betaMetaPath = join(homeDir, getGlobalPatternVectorPaths('local', 'model-beta').meta);
    expect(readFileSync(alphaMetaPath, 'utf8')).toContain('"model": "model-alpha"');
    expect(readFileSync(betaMetaPath, 'utf8')).toContain('"model": "model-beta"');
  });

  it('returns undefined scorers when RAG is disabled or the index remains unavailable', async () => {
    const { PatternStore, PatternVectorService } = await importPatternModules(homeDir);
    const store = new PatternStore();

    const disabledRoot = join(homeDir, 'project-disabled');
    const { writeProjectProfile } = await import('@/core/project-profile.js');
    writeProjectProfile(disabledRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content'],
      stack_profile: {
        frameworks: ['short-video'],
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
      research: { depth: 'standard' },
      intelligence: {
        rag_enabled: false,
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
      efficiency: { differential_refresh: true },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 1000,
      },
      custom: {
        classification_dimensions: [],
        verification_plugins: [],
        escalation_rules: [],
      },
    });

    const vectors = new PatternVectorService(store, vi.fn() as never);
    expect(await vectors.createSemanticScorer(disabledRoot)).toBeUndefined();

    const enabledRoot = join(homeDir, 'project-enabled');
    writeProjectProfile(enabledRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content', 'coding', 'security'],
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
      research: { depth: 'standard' },
      intelligence: {
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
      efficiency: { differential_refresh: true },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 1000,
      },
      custom: {
        classification_dimensions: [],
        verification_plugins: [],
        escalation_rules: [],
      },
    });

    const providerFactory = async () => ({
      name: 'local' as const,
      model: 'fake-local',
      async validate() {
        return;
      },
      async embed() {
        return [[1, 0]];
      },
    });
    const enabledVectors = new PatternVectorService(store, providerFactory as never);
    const refreshSpy = vi.spyOn(enabledVectors, 'refresh').mockResolvedValue();
    const statusSpy = vi.spyOn(enabledVectors, 'getStatus').mockResolvedValue({
      present: true,
      valid: true,
      chunk_count: 1,
    });
    const { FileVectorIndex } = await import('@/rag/vector-index.js');
    const loadSpy = vi.spyOn(FileVectorIndex.prototype, 'load').mockResolvedValue(null);

    expect(await enabledVectors.createSemanticScorer(enabledRoot)).toBeUndefined();

    refreshSpy.mockRestore();
    statusSpy.mockRestore();
    loadSpy.mockRestore();
  });

  it('caches semantic query embeddings and supports the top-level suggester wrapper', async () => {
    const { PatternStore, PatternVectorService, suggestPatternsForProject } =
      await importPatternModules(homeDir);
    const store = new PatternStore();
    await store.save(
      makePattern({
        id: 'pattern-billing',
        problem: 'Concurrent coupon redemption causes duplicate credits.',
        tags: ['billing', 'race-condition'],
      }),
    );

    const embed = vi.fn(async (input: string | string[]) => {
      const batch = Array.isArray(input) ? input : [input];
      return batch.map((text) => (String(text).toLowerCase().includes('coupon') ? [0, 1] : [0, 1]));
    });
    const providerFactory = async () => ({
      name: 'local' as const,
      model: 'fake-local',
      async validate() {
        return;
      },
      embed,
    });

    const projectRoot = join(homeDir, 'project-cache');
    const { writeProjectProfile } = await import('@/core/project-profile.js');
    writeProjectProfile(projectRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content', 'coding', 'security'],
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
      research: { depth: 'standard' },
      intelligence: {
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'fake-local',
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
      efficiency: { differential_refresh: true },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 1000,
      },
      custom: {
        classification_dimensions: [],
        verification_plugins: [],
        escalation_rules: [],
      },
    });

    const vectors = new PatternVectorService(store, providerFactory as never);
    await vectors.rebuild(projectRoot);
    const scorer = await vectors.createSemanticScorer(projectRoot);
    expect(await scorer?.(makePattern({ id: 'pattern-billing' }), [])).toBe(0);
    expect(await scorer?.(makePattern({ id: 'pattern-billing' }), ['coupon'])).toBeGreaterThan(0);
    expect(await scorer?.(makePattern({ id: 'pattern-billing' }), ['coupon'])).toBeGreaterThan(0);
    expect(embed).toHaveBeenCalledTimes(2);

    const createSuggesterSpy = vi
      .spyOn(PatternVectorService.prototype, 'createSuggester')
      .mockResolvedValue({
        suggest: vi.fn().mockResolvedValue([
          {
            pattern: makePattern({ id: 'pattern-billing' }),
            score: 1,
            matched_keywords: ['coupon'],
            is_stale: false,
          },
        ]),
      } as never);

    const results = await suggestPatternsForProject(
      projectRoot,
      ['coupon'],
      'coding',
      ['react'],
      1,
    );
    expect(results[0]?.pattern.id).toBe('pattern-billing');
    createSuggesterSpy.mockRestore();
  });

  it('records patterns with derived category and default tags', async () => {
    const { PatternRecorder } = await importPatternModules(homeDir);
    const save = vi.fn().mockResolvedValue(undefined);

    const recorder = new PatternRecorder({ save } as never);
    const pattern = await recorder.record({
      classification: { workflow: 'root-cause-analysis' },
      projectDirName: 'repo-name',
      domain: 'coding',
      frameworks: ['react'],
      traits: ['tailwind'],
      filesInvolved: ['src/app.ts'],
      problem: 'Problem',
      solution: 'Solution',
      verification: { tests_passed: true, build_passed: false },
    });

    expect(pattern).toMatchObject({
      source_project: 'repo-name',
      category: 'root-cause-analysis',
      tags: [],
    });
    expect(pattern.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(save).toHaveBeenCalledWith(pattern);
  });

  it('lists, prunes, and exports patterns through the CLI', async () => {
    const { PatternCli } = await importPatternModules(homeDir);
    const outputPath = join(homeDir, 'patterns.md');
    const fresh = makePattern({ created_at: '2026-03-01T00:00:00.000Z' });
    const stale = makePattern({
      id: 'pattern-2',
      created_at: '2020-01-01T00:00:00.000Z',
      problem: 'An older pattern that should be pruned.',
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce([fresh])
      .mockResolvedValueOnce([fresh, stale])
      .mockResolvedValueOnce([fresh, stale]);
    const del = vi.fn().mockResolvedValue(undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cli = new PatternCli({ list, delete: del } as never);

    await cli.list({ category: 'bugfix' });
    await cli.prune(30);
    await cli.exportPatterns(outputPath, 'markdown');

    expect(log).toHaveBeenCalledWith(expect.stringContaining('[pattern-] bugfix'));
    expect(del).toHaveBeenCalledWith('pattern-2');
    expect(readFileSync(outputPath, 'utf8')).toContain('# Pattern Library Export');
    expect(log).toHaveBeenCalledWith(`Exported 2 pattern(s) to ${outputPath}`);
  });

  it('prints an empty-state message and can export json', async () => {
    const { PatternCli } = await importPatternModules(homeDir);
    const outputPath = join(homeDir, 'patterns.json');
    const list = vi.fn().mockResolvedValue([]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cli = new PatternCli({ list, delete: vi.fn() } as never);

    await cli.list();
    await cli.exportPatterns(outputPath, 'json');

    expect(log).toHaveBeenCalledWith('No patterns found.');
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toEqual([]);
  });
});
