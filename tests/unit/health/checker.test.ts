import {
  chmodSync,
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HealthChecker } from '@/health/checker.js';
import { ChunkIndexManager } from '@/context/chunk-index.js';
import { PATHS } from '@/core/constants/paths.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import { DocumentationWorkflow } from '@/document/workflow.js';
import { OnboardingOrchestrator } from '@/onboarding/index.js';
import { serializeModuleMap } from '@/onboarding/registry-generator.js';
import { RagService } from '@/rag/service.js';

describe('HealthChecker', () => {
  let projectRoot: string;
  let frameworkHome: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-health-'));
    frameworkHome = join(tmpdir(), `paqad-health-home-${Date.now()}`);
    originalEnv = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    if (existsSync(frameworkHome)) rmSync(frameworkHome, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalEnv;
    }
  });

  it('passes on a freshly onboarded project', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: ['boost'],
      },
    });

    const report = await new HealthChecker().run(projectRoot);

    expect(report.overall_status).toBe('warning');
    expect(report.checks.find((check) => check.name === 'Detection report is valid')?.status).toBe(
      'pass',
    );
    expect(
      report.checks.find((check) => check.name === 'Onboarding manifest is valid')?.status,
    ).toBe('pass');
    expect(report.checks.find((check) => check.name === 'Instruction copies exist')?.status).toBe(
      'pass',
    );
    expect(report.checks.find((check) => check.name === 'Adapter config is present')?.status).toBe(
      'pass',
    );
    expect(
      report.checks.find((check) => check.name === 'Structured test output ready')?.status,
    ).toBe('pass');
  });

  it('does not require stack tool copies for content-only projects', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'content',
        stack: 'short-video',
        capabilities: [],
      },
    });

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'Instruction copies exist')?.status).toBe(
      'pass',
    );
  });

  it('fails with specific errors on broken fixtures', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    // Stage 1: foundation
    await new DocumentationWorkflow().run({ projectRoot, mode: 'foundation' });
    // Stage 2: module-docs — inject known core module map then generate
    mkdirSync(join(projectRoot, PATHS.RULES_DIR), { recursive: true });
    writeFileSync(
      join(projectRoot, PATHS.MODULE_MAP),
      serializeModuleMap({
        version: 1,
        last_updated_at: new Date().toISOString(),
        domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
        modules: [
          {
            name: 'Core',
            slug: 'core',
            auto_update_module_name: true,
            derivation: 'inferred',
            confidence: 'high',
            source_paths: [],
            evidence: {},
            features: [],
          },
        ],
      }),
    );
    await new DocumentationWorkflow().run({ projectRoot, mode: 'module-docs' });
    writeFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'project: bad');
    writeFileSync(join(projectRoot, '.paqad/detection-report.json'), '{');
    rmSync(join(projectRoot, 'docs/modules/core/api/endpoints.md'));

    const report = await new HealthChecker().run(projectRoot);

    expect(report.overall_status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'Profile is valid')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'Detection report is valid')?.status).toBe(
      'fail',
    );
    expect(report.checks.find((check) => check.name === 'API docs present')?.status).toBe('fail');
  });

  it('warns when context hit rate falls below target', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    mkdirSync(join(projectRoot, '.paqad/session'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad/session/context-hit-log.json'),
      JSON.stringify({ hit_rate: 0.2 }),
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(report.overall_status).toBe('warning');
    expect(
      report.checks.find((check) => check.name === 'Context hit rate acceptable')?.status,
    ).toBe('warning');
  });

  it('warns when MCP configuration files are missing', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code', 'codex-cli', 'antigravity', 'gemini-cli'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: ['boost'],
      },
    });

    unlinkSync(join(projectRoot, '.claude/settings.mcp.json'));
    unlinkSync(join(projectRoot, '.codex/mcp.json'));
    unlinkSync(join(projectRoot, '.antigravity/mcp.json'));
    unlinkSync(join(projectRoot, '.gemini/mcp.json'));

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'MCP servers configured')?.status).toBe(
      'warning',
    );
  });

  it('passes adapter config checks for supported adapters outside the legacy top-level files', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['junie'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    rmSync(join(projectRoot, 'AGENTS.md'), { force: true });
    rmSync(join(projectRoot, 'CLAUDE.md'), { force: true });
    rmSync(join(projectRoot, 'ANTIGRAVITY.md'), { force: true });
    rmSync(join(projectRoot, 'GEMINI.md'), { force: true });

    const report = await new HealthChecker().run(projectRoot);

    expect(existsSync(join(projectRoot, '.junie/AGENTS.md'))).toBe(true);
    expect(report.checks.find((check) => check.name === 'Adapter config is present')?.status).toBe(
      'pass',
    );
  });

  it('fails when a generated adapter file is missing the Decision Pause Contract section', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8').replace(
        /## Decision Pause Contract[\s\S]*?Adapter:\nclaude-code/,
        'Adapter:\nclaude-code',
      ),
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'Decision pause contract present')).toEqual(
      expect.objectContaining({
        status: 'fail',
        detail: 'Decision pause contract missing from: CLAUDE.md',
      }),
    );
  });

  it('warns when a generated adapter file drifts from the canonical Decision Pause Contract', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8').replace(
        'Picking a shared piece that affects multiple files',
        'Picking a shared piece that affects one file',
      ),
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'Decision pause contract present')).toEqual(
      expect.objectContaining({
        status: 'warning',
        detail: 'Decision pause contract drift detected in: CLAUDE.md',
      }),
    );
  });

  it('warns when the skill cache is missing', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    rmSync(join(projectRoot, '.paqad/cache/skill-results'), { recursive: true, force: true });

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'Skill cache healthy')?.status).toBe(
      'warning',
    );
  });

  it('warns when the skill cache contains corrupt json', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    mkdirSync(join(projectRoot, '.paqad/cache/skill-results'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/cache/skill-results/bad.json'), '{');

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'Skill cache healthy')?.status).toBe(
      'warning',
    );
  });

  it('warns when RAG is enabled but the vector index is missing', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const profile = readProjectProfile(projectRoot)!;
    profile.intelligence = {
      ...profile.intelligence,
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    };
    writeProjectProfile(projectRoot, profile);

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'RAG index present')?.status).toBe(
      'warning',
    );
    expect(
      report.checks.find((check) => check.name === 'RAG provider matches profile')?.status,
    ).toBe('warning');
    expect(report.checks.find((check) => check.name === 'RAG chunk index present')?.status).toBe(
      'warning',
    );
    expect(report.checks.find((check) => check.name === 'RAG retrieval ready')?.status).toBe(
      'warning',
    );
    expect(
      report.checks.find((check) => check.name === 'RAG vector gitignore present')?.status,
    ).toBe('pass');
    expect(
      report.checks.find((check) => check.name === 'RAG secrets gitignore present')?.status,
    ).toBe('pass');
  });

  it('passes all RAG checks immediately when RAG is disabled', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const report = await new HealthChecker().run(projectRoot);
    const ragChecks = report.checks.filter((check) => check.name.startsWith('RAG '));

    expect(ragChecks).toHaveLength(10);
    expect(ragChecks.every((check) => check.status === 'pass')).toBe(true);
    expect(ragChecks.every((check) => check.detail === 'RAG is disabled')).toBe(true);
  });

  it('warns when the stored RAG provider does not match the current profile', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const profile = readProjectProfile(projectRoot)!;
    profile.intelligence = {
      ...profile.intelligence,
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    };
    writeProjectProfile(projectRoot, profile);
    vi.spyOn(RagService.prototype, 'getStatus').mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'fake-local',
      index_present: true,
      valid: false,
      chunk_count: 1,
      size_bytes: 128,
      reason: 'configured provider/model does not match stored vector metadata',
    });
    vi.spyOn(RagService.prototype, 'localModelCached').mockReturnValue(true);

    const report = await new HealthChecker().run(projectRoot);

    expect(
      report.checks.find((check) => check.name === 'RAG provider matches profile')?.status,
    ).toBe('warning');
  });

  it('warns when the local embedding model cache is missing', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const profile = readProjectProfile(projectRoot)!;
    profile.intelligence = {
      ...profile.intelligence,
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'Xenova/all-MiniLM-L6-v2',
    };
    writeProjectProfile(projectRoot, profile);
    vi.spyOn(RagService.prototype, 'getStatus').mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'Xenova/all-MiniLM-L6-v2',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 128,
    });
    vi.spyOn(RagService.prototype, 'localModelCached').mockReturnValue(false);

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'RAG model cache present')?.status).toBe(
      'warning',
    );
  });

  it('warns when the secrets file permissions are too open', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const profile = readProjectProfile(projectRoot)!;
    profile.intelligence = {
      ...profile.intelligence,
      rag_enabled: true,
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
    };
    writeProjectProfile(projectRoot, profile);
    const secretsPath = join(projectRoot, '.paqad', 'secrets.env');
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(secretsPath, 'OPENAI_API_KEY=sk-test\n');
    chmodSync(secretsPath, 0o644);
    vi.spyOn(RagService.prototype, 'getStatus').mockResolvedValue({
      enabled: true,
      configured_provider: 'openai',
      configured_model: 'text-embedding-3-small',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 128,
    });

    const report = await new HealthChecker().run(projectRoot);

    expect(
      report.checks.find((check) => check.name === 'RAG secret permissions acceptable')?.status,
    ).toBe('warning');
  });

  it('warns when the stored vector index is corrupt', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const profile = readProjectProfile(projectRoot)!;
    profile.intelligence = {
      ...profile.intelligence,
      rag_enabled: true,
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
    };
    writeProjectProfile(projectRoot, profile);
    vi.spyOn(RagService.prototype, 'getStatus').mockResolvedValue({
      enabled: true,
      configured_provider: 'openai',
      configured_model: 'text-embedding-3-small',
      index_present: true,
      valid: false,
      chunk_count: 1,
      size_bytes: 128,
      reason: 'vector index payload is unreadable',
    });

    const report = await new HealthChecker().run(projectRoot);

    expect(
      report.checks.find((check) => check.name === 'RAG provider matches profile')?.status,
    ).toBe('warning');
  });

  it('warns when the chunk index is stale even if vector metadata exists', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const profile = readProjectProfile(projectRoot)!;
    profile.intelligence = {
      ...profile.intelligence,
      rag_enabled: true,
      embedding_provider: 'local',
      embedding_model: 'fake-local',
    };
    writeProjectProfile(projectRoot, profile);
    vi.spyOn(RagService.prototype, 'getStatus').mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'fake-local',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 128,
    });
    vi.spyOn(RagService.prototype, 'localModelCached').mockReturnValue(true);
    vi.spyOn(ChunkIndexManager.prototype, 'load').mockResolvedValue({
      version: 1,
      generated_at: new Date().toISOString(),
      entries: [],
    });
    vi.spyOn(ChunkIndexManager.prototype, 'isStale').mockResolvedValue({
      stale: true,
      changedFiles: ['src/example.ts'],
    });

    mkdirSync(join(projectRoot, '.paqad', 'vectors'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad', 'vectors', 'index.json'),
      JSON.stringify({
        version: 1,
        dimensions: 2,
        items: [{ id: '1', vector: [0.1, 0.2] }],
      }),
    );
    writeFileSync(
      join(projectRoot, '.paqad', 'vectors', 'meta.json'),
      JSON.stringify({
        version: 1,
        provider: 'local',
        model: 'fake-local',
        built_at: new Date().toISOString(),
        chunk_count: 1,
        embedding_dimensions: 2,
      }),
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'RAG chunk index current')?.status).toBe(
      'warning',
    );
    expect(report.checks.find((check) => check.name === 'RAG retrieval ready')?.status).toBe(
      'pass',
    );
  });

  it('fails loudly on a largely missing project scaffold', async () => {
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', 'framework-path.txt'), 'npx paqad-ai');

    const report = await new HealthChecker().run(projectRoot);

    expect(report.overall_status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'Framework artifacts exist')?.status).toBe(
      'fail',
    );
    expect(report.checks.find((check) => check.name === 'Profile is valid')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'Adapter config is present')?.status).toBe(
      'fail',
    );
    expect(
      report.checks.find((check) => check.name === 'Stable framework paths only')?.status,
    ).toBe('fail');
    expect(report.checks.find((check) => check.name === 'MCP servers configured')?.status).toBe(
      'warning',
    );
  });

  it('warns on unreadable context-hit logs, stale registries, and broken scaffold leftovers', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', 'session', 'context-hit-log.json'), '{bad json');
    mkdirSync(join(projectRoot, '.paqad', 'indexes'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad', 'indexes', 'registry-status.json'), '{}');
    writeFileSync(join(projectRoot, 'stale.partial'), 'broken');
    const staleDate = new Date('2020-01-01T00:00:00.000Z');
    chmodSync(join(projectRoot, '.paqad', 'indexes', 'registry-status.json'), 0o644);
    utimesSync(
      join(projectRoot, '.paqad', 'indexes', 'registry-status.json'),
      staleDate,
      staleDate,
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(
      report.checks.find((check) => check.name === 'Context hit rate acceptable')?.status,
    ).toBe('warning');
    expect(report.checks.find((check) => check.name === 'Indexes are current')?.status).toBe(
      'warning',
    );
    expect(report.checks.find((check) => check.name === 'No broken scaffold state')?.status).toBe(
      'fail',
    );
    expect(report.efficiency.context_hit_rate).toBe(0);
  });

  it('passes MCP checks when all recommended servers are configured and local caches are healthy', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: ['boost'],
      },
    });

    writeFileSync(
      join(projectRoot, '.claude/settings.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'laravel-boost': {},
          'database-inspector': {},
        },
      }),
    );
    mkdirSync(join(projectRoot, '.paqad/cache/skill-results'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/cache/skill-results/good.json'), '{"ok":true}');
    mkdirSync(join(projectRoot, '.paqad/indexes'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/indexes/registry-status.json'), '{}');

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'MCP servers configured')?.status).toBe(
      'pass',
    );
    expect(report.checks.find((check) => check.name === 'Skill cache healthy')?.status).toBe(
      'pass',
    );
    expect(report.efficiency.skill_cache_hit_rate).toBe(0);
    expect(report.efficiency.mcp_usage_rate).toBe(0);
  });

  it('passes MCP checks for supported adapters with non-legacy MCP file paths', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['junie'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: ['boost'],
      },
    });

    writeFileSync(
      join(projectRoot, '.junie/mcp/mcp.json'),
      JSON.stringify({
        mcpServers: {
          'laravel-boost': {},
          'database-inspector': {},
        },
      }),
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'MCP servers configured')?.status).toBe(
      'pass',
    );
  });

  it('reports efficiency summary metrics from observed runtime data only', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad', 'session', 'context-hit-log.json'),
      JSON.stringify({ hit_rate: 0.4 }),
    );
    mkdirSync(join(projectRoot, '.paqad', 'cache', 'skill-results'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad', 'cache', 'skill-results', '.stats.json'),
      JSON.stringify({ hits: 3, misses: 1 }),
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(report.efficiency).toEqual({
      context_hit_rate: 0.4,
      skill_cache_hit_rate: 0.75,
      mcp_usage_rate: 0,
    });
  });
});
