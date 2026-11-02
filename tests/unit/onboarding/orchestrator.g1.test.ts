import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';

const { join } = posix;

import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { OnboardingOrchestrator } from '@/onboarding';
import { RagService } from '@/rag/service.js';
import * as optionalPackage from '@/core/optional-package.js';

import {
  useOrchestratorSandbox,
  assertNoProjectLocalSkillsOrAgents,
  findEmptyDirectories,
} from './orchestrator-harness.js';

vi.mock('@/core/optional-package.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/optional-package.js')>();
  return {
    ...actual,
    describeOptionalEngine: vi.fn(actual.describeOptionalEngine),
    maybeStartOptionalEngineInstall: vi.fn(actual.maybeStartOptionalEngineInstall),
  };
});

describe('OnboardingOrchestrator', () => {
  let projectRoot: string;

  useOrchestratorSandbox((sandbox) => {
    ({ projectRoot } = sandbox);
  });

  it('generates framework scaffold files', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    expect(output.generated_files).toContain('CLAUDE.md');
    expect(output.decision_pause_supported_adapters).toEqual(['claude-code']);
    expect(existsSync(join(projectRoot, '.paqad/project-profile.yaml'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/rules/_shared/constitution.md'))).toBe(
      true,
    );
    expect(existsSync(join(projectRoot, '.paqad/hooks/silent-update.sh'))).toBe(false);
    expect(existsSync(join(projectRoot, '.paqad/hooks/silent-update.mjs'))).toBe(false);
    expect(existsSync(join(projectRoot, '.claude/settings.hooks.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude/memory.json'))).toBe(true);
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).not.toContain('silent-update.sh');
    expect(existsSync(join(projectRoot, 'docs/modules/core/api/endpoints.md'))).toBe(false);
    expect(
      existsSync(join(projectRoot, 'docs/instructions/workflows/feature-development.yaml')),
    ).toBe(true);
    expect(existsSync(join(projectRoot, '.paqad/compiled-rules.json'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/rules/rule-script-map.yml'))).toBe(true);
    expect(existsSync(join(projectRoot, '.paqad/module-health/core.json'))).toBe(false);
    const onboardingManifest = JSON.parse(
      readFileSync(join(projectRoot, '.paqad/onboarding-manifest.json'), 'utf8'),
    );
    expect(onboardingManifest.project_root).toBe('.');
    expect(onboardingManifest.planning_artifacts).toEqual(
      expect.objectContaining({
        compiled_rules_path: expect.stringContaining('.paqad/compiled-rules.json'),
        module_health_initialized: [],
      }),
    );
  });

  it('documents the enterprise switches in the team config files and keeps the profile lean', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).not.toContain('enterprise:');

    const appConfig = readFileSync(join(projectRoot, '.paqad/configs/.config.app'), 'utf8');
    expect(appConfig).toMatch(/^# enterprise=false$/m);
    expect(appConfig).toMatch(/^# enterprise_evidence_ledger=false$/m);
    expect(appConfig).toMatch(/^# enterprise_ai_bom=false$/m);
    expect(appConfig).toMatch(/^# enterprise_compliance_citations=false$/m);

    const example = readFileSync(join(projectRoot, '.paqad/.config.example'), 'utf8');
    expect(example).toMatch(/^# enterprise=false$/m);
    expect(example).toMatch(/^# rag_top_n=20$/m);
    expect(example).toMatch(/^# model_default=gpt-5$/m);
  });

  it('returns the no-migration safety net: framework values a legacy fat profile reverted', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });
    const profilePath = join(projectRoot, '.paqad/project-profile.yaml');
    writeFileSync(
      profilePath,
      `${readFileSync(profilePath, 'utf8')}\nenterprise:\n  enabled: true\n  evidence_ledger: false\n  ai_bom: false\n  compliance_citations: false\nresearch:\n  depth: cutting-edge\n`,
    );

    const result = await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(result.reverted_framework_values.sort()).toEqual([
      'enterprise=true',
      'research_depth=cutting-edge',
    ]);
    expect(readFileSync(profilePath, 'utf8')).not.toContain('enterprise:');
    expect(existsSync(join(projectRoot, '.paqad/.config'))).toBe(false);
  });

  it('returns an empty safety net for a clean onboard (nothing reverted)', async () => {
    const result = await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });
    expect(result.reverted_framework_values).toEqual([]);
  });

  it('reports decision pause support for every generated adapter', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: [...ADAPTER_TYPES],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    expect(output.decision_pause_supported_adapters).toEqual([...ADAPTER_TYPES]);
  });

  it('defaults to claude-code adapter only when no providers are specified', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.junie/AGENTS.md'))).toBe(false);
  });

  it('creates only the selected provider files and no others', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        providers: ['codex-cli'],
      },
    });

    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.codex/hooks.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.codex/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.codex/memory.json'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.junie/AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
    expect(existsSync(join(projectRoot, '.junie'))).toBe(false);
    expect(existsSync(join(projectRoot, '.gemini'))).toBe(false);
    assertNoProjectLocalSkillsOrAgents(projectRoot);
  });

  it('writes paqad volatile paths into the nested .paqad/.gitignore during onboarding', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    const gitignore = readFileSync(join(projectRoot, '.paqad', '.gitignore'), 'utf8');
    expect(gitignore).toContain('# >>> paqad-ai managed');
    expect(gitignore).toContain('cache/');
    expect(gitignore).toContain('session/');
    expect(gitignore).toContain('pentest/');
    expect(gitignore).toContain('framework-version.txt');
    expect(gitignore).not.toContain('framework-path.txt');
    expect(gitignore).toContain('ledger/');
  });

  it('finishes a pending evidence migration on onboarding, as update does', async () => {
    const run = '300-gamma-01JABCDEFGHJKMNPQRSTVWXYZ3';
    mkdirSync(join(projectRoot, '.paqad/_specs', run, 'pipeline'), { recursive: true });
    writeFileSync(join(projectRoot, '.paqad/_specs', run, 'pipeline/request.md'), '# Gamma\n');

    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(existsSync(join(projectRoot, '.paqad/_specs'))).toBe(false);
    expect(
      readFileSync(join(projectRoot, '.paqad/ledger/feature-evidence', run, 'request.md'), 'utf8'),
    ).toContain('# Gamma');
  });

  it('enables RAG during onboarding when explicit RAG selections are provided', async () => {
    const configure = vi.spyOn(RagService.prototype, 'configureAndBuild').mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'Xenova/all-MiniLM-L6-v2',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 123,
    });

    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        rag: {
          enabled: true,
          provider: 'local',
        },
      },
    });

    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'Xenova/all-MiniLM-L6-v2',
      }),
      expect.any(Function),
    );
    const teamConfig = readFileSync(join(projectRoot, '.paqad/configs/.config.rag'), 'utf8');
    expect(teamConfig).toContain('rag_enabled=true');
    expect(teamConfig).toContain('rag_embedding_provider=local');
    expect(teamConfig).toContain('rag_embedding_model=Xenova/all-MiniLM-L6-v2');
    expect(existsSync(join(projectRoot, '.paqad/.config'))).toBe(false);
    expect(readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8')).not.toContain(
      'rag_enabled',
    );
  });

  it('falls back cleanly when onboarding-time RAG setup fails', async () => {
    vi.spyOn(RagService.prototype, 'configureAndBuild').mockRejectedValue(
      new Error('model download failed'),
    );

    const output = await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        rag: {
          enabled: true,
          provider: 'local',
        },
      },
    });

    const config = readFileSync(join(projectRoot, '.paqad/configs/.config.rag'), 'utf8');
    expect(config).toContain('rag_enabled=false');
    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).not.toContain('rag_enabled');
    expect(profile).not.toContain('embedding_provider: local');
    expect(existsSync(join(projectRoot, '.paqad/detection-report.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.paqad/framework-version.txt'))).toBe(true);
    expect(existsSync(join(projectRoot, '.paqad/onboarding-manifest.json'))).toBe(true);
    expect(output.warnings).toContain('RAG was turned off: model download failed');
  });

  it('keeps RAG on and starts the background engine install when the engine is missing', async () => {
    vi.mocked(optionalPackage.describeOptionalEngine).mockReturnValueOnce({
      state: 'not installed',
    });
    vi.mocked(optionalPackage.maybeStartOptionalEngineInstall).mockReturnValueOnce('started');
    const configure = vi.spyOn(RagService.prototype, 'configureAndBuild');

    const output = await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        rag: { enabled: true, provider: 'local' },
      },
    });

    expect(optionalPackage.maybeStartOptionalEngineInstall).toHaveBeenCalledWith(
      expect.anything(),
      {},
      { projectRoot },
    );
    expect(configure).not.toHaveBeenCalled();
    const config = readFileSync(join(projectRoot, '.paqad/configs/.config.rag'), 'utf8');
    expect(config).toContain('rag_enabled=true');
    expect(config).not.toContain('rag_enabled=false');
    const installing = output.warnings.filter((line) =>
      line.includes('installing in the background'),
    );
    expect(installing).toEqual([
      'search index is installing in the background; text search until it is ready',
    ]);
    expect(output.warnings.some((line) => line.startsWith('RAG was turned off'))).toBe(false);
  });

  it('turns RAG off and says why when the engine install cannot start', async () => {
    vi.mocked(optionalPackage.describeOptionalEngine).mockReturnValueOnce({
      state: 'not installed',
    });
    vi.mocked(optionalPackage.maybeStartOptionalEngineInstall).mockReturnValueOnce(
      'no-plugin-data',
    );
    vi.spyOn(RagService.prototype, 'configureAndBuild').mockRejectedValue(
      new Error('Failed to load local model Xenova/all-MiniLM-L6-v2'),
    );

    const output = await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        rag: { enabled: true, provider: 'local' },
      },
    });

    const config = readFileSync(join(projectRoot, '.paqad/configs/.config.rag'), 'utf8');
    expect(config).toContain('rag_enabled=false');
    expect(output.warnings).toContain(
      'RAG was turned off: Failed to load local model Xenova/all-MiniLM-L6-v2',
    );
  });

  it('reports a kept entry file in kept_files, never in warnings', async () => {
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Team notes\n');

    const output = await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(output.kept_files).toContain('CLAUDE.md');
    expect(output.warnings).not.toContain('CLAUDE.md');
    expect(Array.isArray(output.drift_review_targets)).toBe(true);
    for (const target of output.drift_review_targets) {
      expect(output.warnings).not.toContain(target);
    }
  });

  it('does not create empty architecture or design-system folders during onboarding', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(existsSync(join(projectRoot, 'docs/instructions/architecture'))).toBe(false);
    expect(existsSync(join(projectRoot, 'docs/instructions/design-system'))).toBe(false);
  });

  it('does not leave empty directories behind during onboarding', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: [...ADAPTER_TYPES],
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(existsSync(join(projectRoot, 'docs/rules'))).toBe(false);
    expect(existsSync(join(projectRoot, 'docs/modules'))).toBe(false);
    expect(findEmptyDirectories(projectRoot)).toEqual([]);
  });

  it('keeps content-only onboarding limited to the content capability', async () => {
    const orchestrator = new OnboardingOrchestrator();

    await orchestrator.run({
      projectRoot,
      selections: {
        domain: 'content',
        stack: 'short-video',
        capabilities: [],
      },
    });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('active_capabilities:');
    expect(profile).toContain('  - content');
    expect(profile).not.toContain('  - coding');
    expect(profile).not.toContain('  - security');
    expect(profile).not.toContain('stack_profile:');
    expect(
      existsSync(join(projectRoot, 'docs/instructions/workflows/feature-development.yaml')),
    ).toBe(false);
  });

  it('does not overwrite an existing feature development policy file', async () => {
    mkdirSync(join(projectRoot, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'docs/instructions/workflows/feature-development.yaml'),
      'schema_version: "1"\n# project-owned customization\n',
    );

    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(
      readFileSync(
        join(projectRoot, 'docs/instructions/workflows/feature-development.yaml'),
        'utf8',
      ),
    ).toContain('# project-owned customization');
  });
});
