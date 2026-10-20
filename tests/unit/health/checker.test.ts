import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  readFileSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { HealthChecker, deriveOverallStatus } from '@/health/checker.js';
import { ChunkIndexManager } from '@/context/chunk-index.js';
import { PATHS } from '@/core/constants/paths.js';
import { compileRules, writeCompiledRules } from '@/planning/rule-compiler.js';
import { syncFrameworkConfig } from '@/core/framework-config.js';
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

  it('lean footprint passes when there is no rules directory (issue #284)', async () => {
    // A bare project (no docs/instructions/rules) has nothing to slim.
    const report = await new HealthChecker().run(projectRoot);
    const check = report.checks.find((c) => c.name === 'Lean rule footprint acceptable');
    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('No rules directory');
  });

  it('lean footprint warns when the artifact is not smaller than the full rule set', async () => {
    mkdirSync(join(projectRoot, PATHS.RULES_DIR), { recursive: true });
    writeFileSync(join(projectRoot, PATHS.RULES_DIR, 'a.md'), 'small');
    mkdirSync(join(projectRoot, '.paqad/context'), { recursive: true });
    writeFileSync(join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT), 'x'.repeat(10_000));

    const report = await new HealthChecker().run(projectRoot);
    const check = report.checks.find((c) => c.name === 'Lean rule footprint acceptable');
    expect(check?.status).toBe('warning');
    expect(check?.detail).toContain('not reducing the resident footprint');
  });

  it('reports the lean rule footprint against the full rule set (issue #284)', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    const report = await new HealthChecker().run(projectRoot);
    const check = report.checks.find((c) => c.name === 'Lean rule footprint acceptable');
    // Onboarding writes the lean artifact unconditionally, so the footprint is
    // reported and passes (the lean slice is smaller than the full rule tree).
    expect(check?.status).toBe('pass');
    expect(check?.detail).toMatch(/Resident rule context is \d+ bytes vs \d+ bytes/);
  });

  it('lean footprint check passes (fallback) when the artifact is absent', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });
    const artifact = join(projectRoot, PATHS.CONTEXT_SESSION_ARTIFACT);
    if (existsSync(artifact)) unlinkSync(artifact);

    const report = await new HealthChecker().run(projectRoot);
    const check = report.checks.find((c) => c.name === 'Lean rule footprint acceptable');
    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('fallback');
  });

  it('fails the compiled-rules-current check when the store is stale (S1/D1)', async () => {
    mkdirSync(join(projectRoot, PATHS.RULES_DIR), { recursive: true });
    writeFileSync(join(projectRoot, PATHS.RULES_DIR, 'a.md'), '# A rule\nrule body');
    // A compiled store whose hash does not match the rules dir → stale.
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(
      join(projectRoot, PATHS.COMPILED_RULES),
      JSON.stringify({
        schema_version: 1,
        generated_at: 'now',
        source_hash: 'sha256:stale',
        rules: [],
      }),
    );

    const report = await new HealthChecker().run(projectRoot);
    const check = report.checks.find((c) => c.name === 'Compiled rules are current');
    expect(check?.status).toBe('fail');
    expect(check?.remediation).toContain('paqad-ai rag refresh-context');
  });

  it('passes the compiled-rules-current check when the store matches the rules (S1/D1)', async () => {
    mkdirSync(join(projectRoot, PATHS.RULES_DIR), { recursive: true });
    writeFileSync(join(projectRoot, PATHS.RULES_DIR, 'a.md'), '# A rule\nrule body');
    await writeCompiledRules(projectRoot, await compileRules(projectRoot));

    const report = await new HealthChecker().run(projectRoot);
    const check = report.checks.find((c) => c.name === 'Compiled rules are current');
    expect(check?.status).toBe('pass');
  });

  it('treats the decision workspace as ready without the git-ignored audit log', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    // audit.jsonl is git-ignored write-only telemetry; a clean clone never
    // carries it and must still be healthy.
    const auditLog = join(projectRoot, PATHS.DECISIONS_AUDIT_LOG);
    if (existsSync(auditLog)) {
      unlinkSync(auditLog);
    }

    const report = await new HealthChecker().run(projectRoot);

    expect(report.checks.find((check) => check.name === 'Decision workspace ready')?.status).toBe(
      'pass',
    );
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

  it('reports MCP servers as a recommendation, never pass or warn (issue #622, AC-10)', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code', 'codex-cli', 'antigravity', 'gemini-cli'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: ['boost'],
      },
    });

    const report = await new HealthChecker().run(projectRoot);
    const mcp = report.checks.find((check) => check.name === 'MCP servers (recommended)');

    expect(mcp?.status).toBe('info');
    expect(mcp?.detail.startsWith('Recommended for this stack:')).toBe(true);
    expect(mcp?.detail).toContain('laravel-boost');
    expect(mcp?.detail).not.toContain('Found in .mcp.json');
    expect(mcp?.remediation).toBeUndefined();
    expect(report.checks.some((check) => check.name === 'MCP servers configured')).toBe(false);
  });

  it('never lets an info check move the overall status (issue #622, INV-6)', () => {
    const info = { name: 'MCP servers (recommended)', status: 'info' as const, detail: 'x' };
    const passed = { name: 'a', status: 'pass' as const, detail: 'ok' };
    const warned = { name: 'b', status: 'warning' as const, detail: 'look' };
    const failed = { name: 'c', status: 'fail' as const, detail: 'bad' };

    expect(deriveOverallStatus([passed, info])).toBe('pass');
    expect(deriveOverallStatus([info])).toBe('pass');
    expect(deriveOverallStatus([passed, info, warned])).toBe('warning');
    expect(deriveOverallStatus([info, failed, warned])).toBe('fail');
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

  it('passes the provider-entry bootstrap-pointer and fallback-clause checks on lean entry files', async () => {
    // Issue #229 — a freshly onboarded entry file is a lean stub that points to
    // the framework bootstrap (`.paqad/framework-path.txt`) and carries the
    // graceful-degradation fallback clause, inlining no contract sections.
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const report = await new HealthChecker().run(projectRoot);

    expect(
      report.checks.find((check) => check.name === 'Entry files point to the framework bootstrap'),
    ).toEqual(
      expect.objectContaining({
        status: 'pass',
        detail: 'Every generated entry file is a lean stub pointing to the framework bootstrap.',
      }),
    );
    expect(
      report.checks.find(
        (check) => check.name === 'Entry files carry the graceful-degradation fallback clause',
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'pass',
        detail: 'Every generated entry file carries the graceful-degradation fallback clause.',
      }),
    );
  });

  it('fails the bootstrap-pointer check when an entry file drops the framework-path pointer', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    // Strip the `.paqad/framework-path.txt` bootstrap pointer so the entry file
    // no longer hands the agent off to the framework bootstrap.
    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8').replaceAll(
        '.paqad/framework-path.txt',
        'MISSING-POINTER',
      ),
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(
      report.checks.find((check) => check.name === 'Entry files point to the framework bootstrap'),
    ).toEqual(
      expect.objectContaining({
        status: 'fail',
        detail: 'Bootstrap pointer (.paqad/framework-path.txt) missing from: CLAUDE.md',
      }),
    );
  });

  it('warns when a stale (pre-#229) entry file still inlines a Decision Pause Contract section', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    // Re-inline a fat contract section to simulate a pre-#229 entry file that a
    // refresh has not yet leaned out. The pointer is still present, so this is a
    // warning (lean-out needed), not a failure.
    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      `${readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')}\n## Decision Pause Contract\n\nStale inlined contract prose.\n`,
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(
      report.checks.find((check) => check.name === 'Entry files point to the framework bootstrap'),
    ).toEqual(
      expect.objectContaining({
        status: 'warning',
        detail: 'Stale (older full-contract) entry file still inlines a contract section in: CLAUDE.md',
      }),
    );
  });

  it('fails the fallback-clause check when an entry file drops the graceful-degradation clause', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    // Remove the byte-identical fallback clause so an absent/disabled paqad could
    // hard-fail the host.
    writeFileSync(
      join(projectRoot, 'CLAUDE.md'),
      readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8').replace(
        'proceed as a normal assistant with no paqad behavior. Do not block.',
        'BLOCK EVERYTHING.',
      ),
    );

    const report = await new HealthChecker().run(projectRoot);

    expect(
      report.checks.find(
        (check) => check.name === 'Entry files carry the graceful-degradation fallback clause',
      ),
    ).toEqual(
      expect.objectContaining({
        status: 'fail',
        detail: 'Graceful-degradation fallback clause missing from: CLAUDE.md',
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
    // Framework knobs (RAG/intelligence) now live in `.paqad/.config`, not the
    // YAML (which writeProjectProfile strips). Persist them so readProjectProfile
    // reflects the enabled state via its overlay.
    syncFrameworkConfig(projectRoot, { intelligence: profile.intelligence });

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
    // Framework knobs (RAG/intelligence) now live in `.paqad/.config`, not the
    // YAML (which writeProjectProfile strips). Persist them so readProjectProfile
    // reflects the enabled state via its overlay.
    syncFrameworkConfig(projectRoot, { intelligence: profile.intelligence });
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
    // Framework knobs (RAG/intelligence) now live in `.paqad/.config`, not the
    // YAML (which writeProjectProfile strips). Persist them so readProjectProfile
    // reflects the enabled state via its overlay.
    syncFrameworkConfig(projectRoot, { intelligence: profile.intelligence });
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
    // Framework knobs (RAG/intelligence) now live in `.paqad/.config`, not the
    // YAML (which writeProjectProfile strips). Persist them so readProjectProfile
    // reflects the enabled state via its overlay.
    syncFrameworkConfig(projectRoot, { intelligence: profile.intelligence });
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
    // Framework knobs (RAG/intelligence) now live in `.paqad/.config`, not the
    // YAML (which writeProjectProfile strips). Persist them so readProjectProfile
    // reflects the enabled state via its overlay.
    syncFrameworkConfig(projectRoot, { intelligence: profile.intelligence });
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
    // Framework knobs (RAG/intelligence) now live in `.paqad/.config`, not the
    // YAML (which writeProjectProfile strips). Persist them so readProjectProfile
    // reflects the enabled state via its overlay.
    syncFrameworkConfig(projectRoot, { intelligence: profile.intelligence });
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
    const mcp = report.checks.find((check) => check.name === 'MCP servers (recommended)');
    expect(mcp?.status).toBe('info');
    expect(mcp?.detail).toContain('Project profile is unavailable');
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

  it('names the servers found in the root .mcp.json and keeps local caches healthy (AC-11)', async () => {
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
      join(projectRoot, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          'laravel-boost': { command: 'php', args: ['artisan', 'boost:mcp'] },
          github: { command: 'npx' },
        },
      }),
    );
    mkdirSync(join(projectRoot, '.paqad/cache/skill-results'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/cache/skill-results/good.json'), '{"ok":true}');
    mkdirSync(join(projectRoot, '.paqad/indexes'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/indexes/registry-status.json'), '{}');

    const report = await new HealthChecker().run(projectRoot);

    const mcp = report.checks.find((check) => check.name === 'MCP servers (recommended)');
    expect(mcp?.status).toBe('info');
    expect(mcp?.detail).toContain('Found in .mcp.json: laravel-boost, github.');
    expect(report.checks.find((check) => check.name === 'Skill cache healthy')?.status).toBe(
      'pass',
    );
    expect(report.efficiency.skill_cache_hit_rate).toBe(0);
    expect(report.efficiency.mcp_usage_rate).toBe(0);
  });

  it("never reads other tools' MCP files and ignores an unparseable .mcp.json", async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['junie'],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: ['boost'],
      },
    });

    mkdirSync(join(projectRoot, '.junie/mcp'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.junie/mcp/mcp.json'),
      JSON.stringify({ mcpServers: { 'laravel-boost': { command: 'php' } } }),
    );
    writeFileSync(join(projectRoot, '.mcp.json'), '{ not json');

    const report = await new HealthChecker().run(projectRoot);
    const mcp = report.checks.find((check) => check.name === 'MCP servers (recommended)');

    expect(mcp?.status).toBe('info');
    expect(mcp?.detail).not.toContain('Found in');

    writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify({}));
    const empty = (await new HealthChecker().run(projectRoot)).checks.find(
      (check) => check.name === 'MCP servers (recommended)',
    );
    expect(empty?.detail).toContain('Found in .mcp.json: none.');

    writeFileSync(join(projectRoot, '.mcp.json'), 'null');
    const nullFile = (await new HealthChecker().run(projectRoot)).checks.find(
      (check) => check.name === 'MCP servers (recommended)',
    );
    expect(nullFile?.detail).toContain('Found in .mcp.json: none.');

    // A non-object mcpServers (an array or a string) lists no servers instead of indices or letters.
    for (const mcpServers of [['a', 'b'], 'abc']) {
      writeFileSync(join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers }));
      const odd = (await new HealthChecker().run(projectRoot)).checks.find(
        (check) => check.name === 'MCP servers (recommended)',
      );
      expect(odd?.detail).toContain('Found in .mcp.json: none.');
    }
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
  // Issue #616 Part 9 — doctor warns, with the verbatim update line, when the layout is from the future.
  it('warns when the .paqad layout was written by a newer paqad', async () => {
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad', 'schema-version.json'),
      JSON.stringify({
        paqad_schema_version: '999.0.0',
        written_at: new Date().toISOString(),
        written_by_engine_version: '999.0.0',
      }),
    );
    const report = await new HealthChecker().run(projectRoot);
    const check = report.checks.find((c) => c.name === 'Schema version');
    expect(check?.status).toBe('warning');
    expect(check?.remediation).toContain('claude plugin update paqad@eliyce');
  });

  it('passes the schema version check when no marker is present', async () => {
    const report = await new HealthChecker().run(projectRoot);
    expect(report.checks.find((c) => c.name === 'Schema version')?.status).toBe('pass');
  });
});

describe('doctor framework-link repair (issue #636 bug 3)', () => {
  const CMD = 'ln -sfn "$(npm root -g)/paqad-ai/runtime" ~/.paqad-ai/current';
  let saved: string | undefined;
  let link: string;

  beforeEach(() => {
    saved = process.env.PAQAD_FRAMEWORK_HOME;
    link = join(tmpdir(), `paqad-dangling-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });
  afterEach(() => {
    try {
      if (lstatSync(link)) rmSync(link, { force: true });
    } catch {
      /* not created */
    }
    if (saved === undefined) delete process.env.PAQAD_FRAMEWORK_HOME;
    else process.env.PAQAD_FRAMEWORK_HOME = saved;
  });

  it('warns and prints the exact repair command for a DANGLING framework link', async () => {
    symlinkSync(join(tmpdir(), 'paqad-gone-target-does-not-exist'), link);
    process.env.PAQAD_FRAMEWORK_HOME = link;
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-doctor-'));
    try {
      const report = await new HealthChecker().run(projectRoot);
      const check = report.checks.find((c) => c.name === 'Framework install');
      expect(check?.status).toBe('warning');
      expect(check?.remediation).toContain(CMD);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('prints the exact repair command for a MISSING framework link too', async () => {
    process.env.PAQAD_FRAMEWORK_HOME = join(tmpdir(), `paqad-missing-${Date.now()}`);
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-doctor-'));
    try {
      const report = await new HealthChecker().run(projectRoot);
      const check = report.checks.find((c) => c.name === 'Framework install');
      expect(check?.status).toBe('warning');
      expect(check?.remediation).toContain(CMD);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('doctor Claude Code install line (issue #648, B5)', () => {
  // HOME is sandboxed per test file (tests/shared/isolate-home.ts), so these writes stay in a temp dir.
  afterEach(() => {
    rmSync(join(homedir(), '.paqad-ai', 'plugin-migration.json'), { force: true });
    rmSync(join(homedir(), '.claude', 'settings.json'), { force: true });
  });

  it('shows declined at once when the user turned the plugin off after the move', async () => {
    mkdirSync(join(homedir(), '.paqad-ai'), { recursive: true });
    writeFileSync(
      join(homedir(), '.paqad-ai', 'plugin-migration.json'),
      JSON.stringify({ state: 'done', path: 'cli', attempts: 1, version: '1' }),
    );
    mkdirSync(join(homedir(), '.claude'), { recursive: true });
    writeFileSync(
      join(homedir(), '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'paqad@eliyce': false } }),
    );
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-doctor-'));
    try {
      const report = await new HealthChecker().run(projectRoot);
      const check = report.checks.find((c) => c.name === 'Claude Code install');
      expect(check?.detail).toBe('npm (migration declined: user-disabled)');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('is a warning with the IT fix when a managed policy blocks the hooks', async () => {
    const policy = join(homedir(), 'fake-managed-settings.json');
    writeFileSync(policy, JSON.stringify({ allowManagedHooksOnly: true }));
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-doctor-'));
    try {
      const report = await new HealthChecker({ managedSettingsPaths: [policy] }).run(projectRoot);
      const check = report.checks.find((c) => c.name === 'Claude Code install');
      expect(check).toMatchObject({
        status: 'warning',
        detail: "A managed policy blocks paqad's hooks, so paqad's checks don't run here.",
        remediation: 'Ask IT to deploy the paqad plugin as a managed plugin, or allow its hooks.',
      });
    } finally {
      rmSync(policy, { force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('passes the project root, so it says when this project still runs the npm hooks (issue #667)', async () => {
    mkdirSync(join(homedir(), '.paqad-ai'), { recursive: true });
    writeFileSync(
      join(homedir(), '.paqad-ai', 'plugin-migration.json'),
      JSON.stringify({ state: 'done', path: 'synced', attempts: 1, version: '1' }),
    );
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-doctor-'));
    try {
      const script = join(projectRoot, 'hooks', 'capability-gate.mjs');
      mkdirSync(join(projectRoot, 'hooks'), { recursive: true });
      writeFileSync(script, '');
      mkdirSync(join(projectRoot, '.claude'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.claude', 'settings.json'),
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: `node "${script}"` }] }] } }),
      );
      const report = await new HealthChecker().run(projectRoot);
      const check = report.checks.find((c) => c.name === 'Claude Code install');
      expect(check?.detail).toBe(
        'plugin (synced from claude.ai); this project still runs the npm hooks (project .claude/settings.json)',
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
