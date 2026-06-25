import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TurnSummarizer } from '@/context/turn-summarizer.js';
import { syncFrameworkConfig } from '@/core/framework-config.js';
import * as projectProfileModule from '@/core/project-profile.js';
import { writeProjectProfile } from '@/core/project-profile.js';
import { HandoffParser, HandoffWriter, SessionResumeValidator } from '@/session/index.js';

describe('HandoffWriter', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-session-'));
    const profile = {
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
        rag_enabled: true,
        embedding_provider: 'local' as const,
        embedding_model: 'fake-local',
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
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
    writeProjectProfile(projectRoot, profile);
    // Framework knobs (intelligence/strictness/escalation/...) now resolve from
    // `.paqad/.config`, not the YAML which strips them. Persist them so
    // readProjectProfile() returns the settings these tests depend on.
    syncFrameworkConfig(projectRoot, profile);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('writes structured handoff artifacts with derived compression stats', async () => {
    const writer = new HandoffWriter(new TurnSummarizer(), projectRoot);

    const handoff = await writer.write(
      [
        {
          text: 'We decided to use Postgres. Updated src/core/project-profile.ts. Next step: write docs.',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          text: 'Blocked by auth outage. Updated tests/unit/core/project-profile.test.ts. TODO: run tests.',
          timestamp: '2024-01-01T00:05:00.000Z',
        },
      ],
      'stack-hash',
      'session-123',
      {
        classification: 'implementation',
        description: 'Ship the update flow',
        spec_path: 'docs/spec.md',
      },
      {
        spec_artifacts: ['docs/spec.md'],
        relevant_files: ['src/core/project-profile.ts'],
        relevant_docs: ['docs/maintainers/project-overview.md'],
      },
      200,
      {
        manifest_slug: 'runtime-manifest',
        completed_slices: ['SL-1'],
        current_slice: 'SL-2',
        current_slice_status: 'in-progress',
        pending_slices: ['SL-3'],
        escalated_slices: [],
      },
    );

    expect(handoff.session_id).toBe('session-123');
    expect(handoff.retrieval).toEqual({
      rag_enabled: true,
      embedding_provider: 'local',
    });
    expect(handoff.decisions).toEqual([{ description: 'use Postgres', rationale: '' }]);
    expect(handoff.files_modified).toEqual([
      'src/core/project-profile.ts',
      'tests/unit/core/project-profile.test.ts',
    ]);
    expect(handoff.blockers).toEqual([{ description: 'auth outage', severity: 'warning' }]);
    expect(handoff.next_steps).toEqual([': write docs', 'run tests']);
    expect(handoff.compression_stats.handoff_tokens).toBeGreaterThan(0);
    expect(handoff.compression_stats.compression_ratio).toBeGreaterThan(0);

    const sessionDir = join(projectRoot, '.paqad', 'session');
    const json = JSON.parse(readFileSync(join(sessionDir, 'handoff.json'), 'utf8'));
    const markdown = readFileSync(join(sessionDir, 'handoff.md'), 'utf8');
    const stats = JSON.parse(readFileSync(join(sessionDir, 'handoff-stats.json'), 'utf8'));
    const budgetState = JSON.parse(readFileSync(join(sessionDir, 'context-budget.json'), 'utf8'));

    expect(json).toMatchObject({ session_id: 'session-123', stack_state_hash: 'stack-hash' });
    expect(markdown).toContain('# Session Handoff');
    expect(markdown).toContain('**RAG enabled:** yes');
    expect(markdown).toContain('**Spec:** docs/spec.md');
    expect(markdown).toContain('## Execution Progress');
    expect(markdown).toContain('runtime-manifest');
    expect(markdown).toContain('src/core/project-profile.ts');
    expect(budgetState).toMatchObject({
      tier: 'green',
      tokens_used: 200,
      max_tokens: 30000,
      summarized_turn_count: 0,
      evicted_segment_count: 0,
    });
    expect(stats).toEqual({
      session_id: 'session-123',
      original_context_tokens: 200,
      handoff_tokens: handoff.compression_stats.handoff_tokens,
      compression_ratio: handoff.compression_stats.compression_ratio,
    });
  });

  it('omits the spec line from markdown when no spec path is provided', async () => {
    const writer = new HandoffWriter(new TurnSummarizer(), projectRoot);

    await writer.write(
      [{ text: 'Next step: clean up tests.', timestamp: '2024-01-01T00:00:00.000Z' }],
      'stack-hash',
      'session-456',
      {
        classification: 'maintenance',
        description: 'Cleanup',
        spec_path: null,
      },
      {
        spec_artifacts: [],
        relevant_files: [],
        relevant_docs: [],
      },
      0,
    );

    const markdown = readFileSync(join(projectRoot, '.paqad', 'session', 'handoff.md'), 'utf8');
    expect(markdown).not.toContain('**Spec:**');
    expect(markdown).toContain('Compression ratio: 0.0%');
  });

  it('uses profile efficiency settings when persisting context budget state', async () => {
    const profile = {
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
        rag_enabled: true,
        embedding_provider: 'local' as const,
        embedding_model: 'fake-local',
        rag_similarity_threshold: 0.75,
        rag_top_n: 20,
      },
      efficiency: {
        differential_refresh: true,
        context_budget_strategy: 'aggressive' as const,
        auto_summarize_interval: 1,
      },
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
    writeProjectProfile(projectRoot, profile);
    syncFrameworkConfig(projectRoot, profile);
    // `context_budget_strategy` and `auto_summarize_interval` are
    // framework-internal efficiency tuning (Bucket C) with no `.config` key, so
    // readProjectProfile() resolves efficiency to defaults. Overlay just those two
    // tuning knobs onto the real resolved profile for the duration of this test so
    // the optimizer still sees the aggressive strategy this case exercises.
    const realReadProjectProfile = projectProfileModule.readProjectProfile;
    const readSpy = vi
      .spyOn(projectProfileModule, 'readProjectProfile')
      .mockImplementation((root: string) => {
        const resolved = realReadProjectProfile(root);
        return resolved
          ? {
              ...resolved,
              efficiency: {
                ...resolved.efficiency,
                context_budget_strategy: 'aggressive',
                auto_summarize_interval: 1,
              },
            }
          : resolved;
      });

    const writer = new HandoffWriter(new TurnSummarizer(), projectRoot);
    await writer.write(
      [
        {
          text: 'decided to use Postgres. Next step: write docs.',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        {
          text: 'updated src/context/budget-optimizer.ts. TODO: add tests.',
          timestamp: '2024-01-01T00:01:00.000Z',
        },
        { text: 'blocked by flaky CI. Next step: rerun.', timestamp: '2024-01-01T00:02:00.000Z' },
      ],
      'stack-hash',
      'session-789',
      {
        classification: 'implementation',
        description: 'Tighten runtime budget handling',
        spec_path: null,
      },
      {
        spec_artifacts: [],
        relevant_files: ['src/context/budget-optimizer.ts'],
        relevant_docs: [],
      },
      22000,
    );

    const budgetState = JSON.parse(
      readFileSync(join(projectRoot, '.paqad', 'session', 'context-budget.json'), 'utf8'),
    );

    expect(budgetState).toMatchObject({
      tier: 'amber',
      tokens_used: 22000,
      max_tokens: 30000,
      summarized_turn_count: 2,
      evicted_segment_count: 0,
      recommended_action: 'warn',
      enforcement_reason: 'healthy',
    });

    readSpy.mockRestore();
  });

  it('forces compaction when the latest hit rate falls below the configured target', async () => {
    mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad', 'session', 'context-hit-log.json'),
      JSON.stringify({ hit_rate: 0.4 }),
      'utf8',
    );

    const writer = new HandoffWriter(new TurnSummarizer(), projectRoot);
    await writer.write(
      [{ text: 'Next step: tighten semantic loading.', timestamp: '2024-01-01T00:00:00.000Z' }],
      'stack-hash',
      'session-hit-rate',
      {
        classification: 'analysis',
        description: 'Investigate context quality',
        spec_path: null,
      },
      {
        spec_artifacts: [],
        relevant_files: [],
        relevant_docs: [],
      },
      1000,
    );

    const budgetState = JSON.parse(
      readFileSync(join(projectRoot, '.paqad', 'session', 'context-budget.json'), 'utf8'),
    );
    expect(budgetState).toMatchObject({
      tier: 'red',
      tokens_used: 1000,
      max_tokens: 30000,
      recommended_action: 'compact',
      enforcement_reason: 'context-hit-rate-below-target',
    });
  });
});

describe('HandoffParser', () => {
  let projectRoot: string;
  const parser = new HandoffParser();

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-session-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('parses v2 structured handoffs before falling back to markdown', async () => {
    const dir = join(projectRoot, '.paqad', 'session');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad', 'session', 'handoff.json'),
      JSON.stringify({
        version: 2,
        session_id: 'session-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        stack_state_hash: 'hash',
        retrieval: {
          rag_enabled: false,
          embedding_provider: undefined,
        },
        active_task: {
          classification: 'implementation',
          description: 'desc',
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
          original_context_tokens: 1,
          handoff_tokens: 1,
          compression_ratio: 1,
        },
      }),
      'utf8',
    );
    writeFileSync(join(projectRoot, '.paqad', 'session', 'handoff.md'), '# legacy', 'utf8');

    const parsed = await parser.parse(projectRoot);

    expect(parsed).not.toBeNull();
    expect(parser.isStructured(parsed!)).toBe(true);
    expect(parsed).toMatchObject({ version: 2 });
  });

  it('falls back to legacy markdown and returns null when nothing exists', async () => {
    const sessionDir = join(projectRoot, '.paqad', 'session');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'handoff.md'), '# legacy handoff', 'utf8');

    const legacy = await parser.parse(projectRoot);
    expect(legacy).toEqual({ version: 1, data: '# legacy handoff' });
    expect(parser.isStructured(legacy!)).toBe(false);

    rmSync(join(projectRoot, '.paqad'), { recursive: true, force: true });
    await expect(parser.parse(projectRoot)).resolves.toBeNull();
  });

  it('throws an explicit error for unsupported structured handoff versions instead of falling back', async () => {
    const sessionDir = join(projectRoot, '.paqad', 'session');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'handoff.json'),
      JSON.stringify({
        version: 3,
        session_id: 'future-session',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
      'utf8',
    );
    writeFileSync(join(sessionDir, 'handoff.md'), '# legacy handoff', 'utf8');

    await expect(parser.parse(projectRoot)).rejects.toThrow(
      'Unsupported structured handoff version: 3',
    );
  });
});

describe('SessionResumeValidator', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-session-resume-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('warns when structured handoff expects RAG but the index is stale or missing', async () => {
    const dir = join(projectRoot, '.paqad', 'session');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'handoff.json'),
      JSON.stringify({
        version: 2,
        session_id: 'resume-1',
        timestamp: '2024-01-01T00:00:00.000Z',
        stack_state_hash: 'hash',
        retrieval: {
          rag_enabled: true,
          embedding_provider: 'local',
        },
        active_task: {
          classification: 'implementation',
          description: 'resume',
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
          original_context_tokens: 1,
          handoff_tokens: 1,
          compression_ratio: 1,
        },
      }),
      'utf8',
    );
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

    const result = await new SessionResumeValidator().validate(projectRoot);

    expect(result.index_valid).toBe(false);
    expect(result.rebuild_required).toBe(true);
    expect(result.warning).toContain('paqad-ai rag rebuild');
  });

  it('returns a no-op result when there is no structured handoff to validate', async () => {
    const validator = new SessionResumeValidator({
      parse: vi.fn().mockResolvedValue(null),
      isStructured: vi.fn(),
    } as never);

    await expect(validator.validate(projectRoot)).resolves.toEqual({
      rag_enabled: false,
      embedding_provider: undefined,
      index_valid: true,
      rebuild_required: false,
    });
  });

  it('passes resume validation when the stored RAG index is still valid', async () => {
    const validator = new SessionResumeValidator(
      {
        parse: vi.fn().mockResolvedValue({
          version: 2,
          data: {
            retrieval: {
              rag_enabled: true,
              embedding_provider: 'local',
            },
          },
        }),
        isStructured: vi.fn().mockReturnValue(true),
      } as never,
      () =>
        ({
          getStatus: vi.fn().mockResolvedValue({
            index_present: true,
            valid: true,
          }),
        }) as never,
    );

    await expect(validator.validate(projectRoot)).resolves.toEqual({
      rag_enabled: true,
      embedding_provider: 'local',
      index_valid: true,
      rebuild_required: false,
    });
  });
});
