import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { createRefreshCommand } from '@/cli/commands/refresh.js';
import { DifferentialRefresh } from '@/context/differential-refresh.js';
import { writeProjectProfile } from '@/core/project-profile.js';
import { DesignTokenService } from '@/design-tokens/service.js';
import { Detector } from '@/detection/detector.js';
import { StackSnapshotCache } from '@/introspection/cache.js';
import { StackIntrospector } from '@/introspection/stack-introspector.js';
import { RagService } from '@/rag/service.js';
import { writeStackArtifacts } from '@/stack-docs/generator.js';

vi.mock('@/stack-docs/generator.js', () => ({
  writeStackArtifacts: vi.fn(),
}));

describe('refresh command', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-refresh-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeProjectProfile(projectRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content'],
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
        supply_chain_governance: false,
        ai_governance: false,
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

    vi.spyOn(DesignTokenService.prototype, 'writeDocs').mockResolvedValue();
    vi.spyOn(DesignTokenService.prototype, 'writeThemeExports').mockResolvedValue([]);
    vi.spyOn(RagService.prototype, 'refreshContext').mockResolvedValue({
      index: { version: 1, generated_at: new Date().toISOString(), entries: [] },
      changed_files: [],
      added_files: [],
      deleted_files: [],
      updated: false,
    });
    vi.spyOn(StackSnapshotCache.prototype, 'read').mockResolvedValue(null);
    vi.spyOn(Detector.prototype, 'detect').mockResolvedValue({
      detected_domain: 'coding',
      detected_stack: 'laravel',
      detected_capabilities: ['boost'],
      confidence: 'high',
      signals: [],
      timestamp: new Date().toISOString(),
      matched_packs: ['laravel'],
      detected_traits: ['boost'],
      recommended_capabilities: ['content', 'coding', 'security'],
    });
    vi.spyOn(StackIntrospector.prototype, 'snapshot').mockResolvedValue({
      hash: 'snapshot-hash',
      generated_at: new Date().toISOString(),
      profile: {
        frameworks: ['laravel'],
        traits: ['boost'],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
      toolchains: [],
      packages: [],
      sources: [],
    });
    vi.mocked(writeStackArtifacts).mockResolvedValue({
      changed: true,
      notes: ['stack changed'],
      previousHash: null,
      nextHash: 'snapshot-hash',
    });
    vi.spyOn(DifferentialRefresh.prototype, 'refresh').mockResolvedValue({
      total_registries: 13,
      refreshed: 1,
      skipped: 12,
      registries: ['api-registry.md'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('updates the canonical profile and writes capability-aware drift metadata', async () => {
    const command = createRefreshCommand();
    await command.parseAsync(['node', 'refresh', '--project-root', projectRoot], {
      from: 'node',
    });

    const profile = YAML.parse(
      readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8'),
    ) as {
      active_capabilities: string[];
      stack_profile?: { frameworks: string[]; traits: string[] };
    };
    expect(profile.active_capabilities).toEqual(['content', 'coding', 'security']);
    expect(profile.stack_profile?.frameworks).toEqual(['laravel']);
    expect(profile.stack_profile?.traits).toEqual(['boost']);

    const drift = JSON.parse(
      readFileSync(join(projectRoot, '.paqad/stack-drift.json'), 'utf8'),
    ) as {
      previous_capabilities: string[];
      current_capabilities: string[];
      previous_packs: string[];
      current_packs: string[];
      stack_drift: { changed: boolean; nextHash: string | null };
    };
    expect(drift.previous_capabilities).toEqual(['content']);
    expect(drift.current_capabilities).toEqual(['content', 'coding', 'security']);
    expect(drift.previous_packs).toEqual([]);
    expect(drift.current_packs).toEqual(['laravel']);
    expect(drift.stack_drift).toMatchObject({ changed: true, nextHash: 'snapshot-hash' });
  });

  it('only refreshes stack artifacts when --stack is passed explicitly', async () => {
    const command = createRefreshCommand();

    await command.parseAsync(['node', 'refresh', '--project-root', projectRoot, '--stack'], {
      from: 'node',
    });

    expect(DesignTokenService.prototype.writeDocs).not.toHaveBeenCalled();
    expect(DesignTokenService.prototype.writeThemeExports).not.toHaveBeenCalled();
    expect(writeStackArtifacts).toHaveBeenCalledOnce();
  });

  it('runs differential refresh from tracked changed files during stack refresh', async () => {
    mkdirSync(join(projectRoot, '.paqad/session'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad/session/changed-files.json'),
      JSON.stringify(['app/Http/Controllers/UserController.php']),
    );

    const command = createRefreshCommand();
    await command.parseAsync(['node', 'refresh', '--project-root', projectRoot, '--stack'], {
      from: 'node',
    });

    expect(DifferentialRefresh.prototype.refresh).toHaveBeenCalledWith([
      'app/Http/Controllers/UserController.php',
    ]);
    const drift = JSON.parse(
      readFileSync(join(projectRoot, '.paqad/stack-drift.json'), 'utf8'),
    ) as {
      differential_refresh: { changed_files: string[]; registries: string[] };
    };
    expect(drift.differential_refresh).toMatchObject({
      changed_files: ['app/Http/Controllers/UserController.php'],
      registries: ['api-registry.md'],
    });
  });

  it('only refreshes design-system artifacts when --design-system is passed explicitly', async () => {
    writeProjectProfile(projectRoot, {
      ...YAML.parse(readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8')),
      stack_profile: {
        frameworks: ['laravel'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });

    const command = createRefreshCommand();

    await command.parseAsync(
      ['node', 'refresh', '--project-root', projectRoot, '--design-system'],
      {
        from: 'node',
      },
    );

    expect(DesignTokenService.prototype.writeDocs).toHaveBeenCalledOnce();
    expect(DesignTokenService.prototype.writeThemeExports).toHaveBeenCalledWith(
      projectRoot,
      'laravel',
    );
    expect(writeStackArtifacts).not.toHaveBeenCalled();
  });

  it('falls back to null theme-export stack when the profile has no recognized stack', async () => {
    writeProjectProfile(projectRoot, {
      ...YAML.parse(readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8')),
      stack_profile: {
        frameworks: ['unknown-stack'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });

    const command = createRefreshCommand();

    await command.parseAsync(
      ['node', 'refresh', '--project-root', projectRoot, '--design-system'],
      {
        from: 'node',
      },
    );

    expect(DesignTokenService.prototype.writeThemeExports).toHaveBeenCalledWith(projectRoot, null);
  });

  it('refreshes context indexes only when --context is passed explicitly', async () => {
    vi.spyOn(RagService.prototype, 'refreshContext').mockResolvedValueOnce({
      index: { version: 1, generated_at: new Date().toISOString(), entries: [] },
      changed_files: ['src/components/Button.tsx'],
      added_files: [],
      deleted_files: [],
      updated: true,
    });
    const command = createRefreshCommand();

    await command.parseAsync(['node', 'refresh', '--project-root', projectRoot, '--context'], {
      from: 'node',
    });

    expect(RagService.prototype.refreshContext).toHaveBeenCalledOnce();
    expect(DifferentialRefresh.prototype.refresh).toHaveBeenCalledWith([
      'src/components/Button.tsx',
    ]);
    expect(writeStackArtifacts).not.toHaveBeenCalled();
    expect(DesignTokenService.prototype.writeDocs).not.toHaveBeenCalled();
    expect(DesignTokenService.prototype.writeThemeExports).not.toHaveBeenCalled();
  });

  it('falls back to content capabilities and replaces invalid drift json', async () => {
    vi.spyOn(Detector.prototype, 'detect').mockResolvedValueOnce({
      detected_domain: 'coding',
      detected_stack: 'laravel',
      detected_capabilities: ['boost'],
      confidence: 'high',
      signals: [],
      timestamp: new Date().toISOString(),
      matched_packs: undefined,
      detected_traits: ['boost'],
      recommended_capabilities: undefined,
    });
    writeFileSync(join(projectRoot, '.paqad/stack-drift.json'), '{invalid json');

    const command = createRefreshCommand();
    await command.parseAsync(['node', 'refresh', '--project-root', projectRoot, '--stack'], {
      from: 'node',
    });

    const profile = YAML.parse(
      readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8'),
    ) as {
      active_capabilities: string[];
      stack_profile?: unknown;
    };
    expect(profile.active_capabilities).toEqual(['content']);
    expect(profile.stack_profile).toBeUndefined();

    const drift = JSON.parse(
      readFileSync(join(projectRoot, '.paqad/stack-drift.json'), 'utf8'),
    ) as {
      current_capabilities: string[];
      current_packs: string[];
    };
    expect(drift.current_capabilities).toEqual(['content']);
    expect(drift.current_packs).toEqual([]);
  });

  it('skips profile and drift writes when the canonical profile is absent', async () => {
    unlinkSync(join(projectRoot, '.paqad/project-profile.yaml'));

    const command = createRefreshCommand();
    await command.parseAsync(['node', 'refresh', '--project-root', projectRoot, '--stack'], {
      from: 'node',
    });

    expect(writeStackArtifacts).toHaveBeenCalledOnce();
    expect(existsSync(join(projectRoot, '.paqad/stack-drift.json'))).toBe(false);
  });
});
