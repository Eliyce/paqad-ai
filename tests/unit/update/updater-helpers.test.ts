import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

import YAML from 'yaml';

import { FrameworkUpdater } from '@/update/index.js';
import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';

function writeProjectProfile(projectRoot: string): void {
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad', 'project-profile.yaml'),
    YAML.stringify({
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      routing: { domain: 'coding', stack: 'laravel', capabilities: [] },
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
      efficiency: {
        context_hit_rate_target: 0.7,
        skill_caching: true,
        differential_refresh: true,
        mcp_first: true,
      },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 10,
      },
      custom: {
        classification_dimensions: [],
        verification_plugins: [],
        escalation_rules: [],
      },
    }),
  );
}

describe('FrameworkUpdater helper paths', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-update-helper-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('throws when no project profile exists for generated candidates', async () => {
    await expect(new FrameworkUpdater().run(projectRoot)).rejects.toThrow(
      'Cannot update framework-managed artifacts without a project profile',
    );
  });

  it('collects generated files from the temporary onboarding scaffold when no candidate generator is provided', async () => {
    writeProjectProfile(projectRoot);

    vi.spyOn(OnboardingOrchestrator.prototype, 'run').mockImplementation(
      async ({ projectRoot }) => {
        mkdirSync(join(projectRoot, 'docs'), { recursive: true });
        mkdirSync(join(projectRoot, 'scripts'), { recursive: true });
        writeFileSync(join(projectRoot, 'docs', 'guide.md'), '# Guide\n');
        writeFileSync(join(projectRoot, 'scripts', 'verify.sh'), '#!/usr/bin/env bash\necho ok\n');

        return { generated_files: [] } as never;
      },
    );

    const report = await new FrameworkUpdater().run(projectRoot);

    expect(report.regenerated).toEqual(['docs/guide.md', 'scripts/verify.sh']);
    expect(report.new_scripts).toEqual(['scripts/verify.sh']);
    expect(readFileSync(join(projectRoot, 'docs', 'guide.md'), 'utf8')).toBe('# Guide\n');
    expect(readFileSync(join(projectRoot, 'scripts', 'verify.sh'), 'utf8')).toContain('echo ok');
  });

  it('preserves candidate auto-update policy from the temporary onboarding manifest', async () => {
    writeProjectProfile(projectRoot);
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs', 'guide.md'), 'current guide\n');

    vi.spyOn(OnboardingOrchestrator.prototype, 'run').mockImplementation(
      async ({ projectRoot }) => {
        mkdirSync(join(projectRoot, 'docs'), { recursive: true });
        mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
        writeFileSync(join(projectRoot, 'docs', 'guide.md'), '# Framework Guide\n');
        writeFileSync(
          join(projectRoot, '.paqad', 'onboarding-manifest.json'),
          JSON.stringify(
            {
              framework_version: '0.0.0',
              adapter: 'claude-code',
              project_root: projectRoot,
              profile: {},
              detected: null,
              generated_at: new Date().toISOString(),
              generated_artifacts: [{ path: 'docs/guide.md', auto_update: false }],
            },
            null,
            2,
          ),
        );

        return { generated_files: ['docs/guide.md'] } as never;
      },
    );

    const report = await new FrameworkUpdater().run(projectRoot);

    expect(report.regenerated).toEqual([]);
    expect(report.skipped).toEqual([
      {
        path: 'docs/guide.md',
        before: 'current guide\n',
        after: '# Framework Guide\n',
      },
    ]);
    expect(readFileSync(join(projectRoot, 'docs', 'guide.md'), 'utf8')).toBe('current guide\n');
  });

  it('does not regenerate provider-local skills or agents from temporary onboarding output', async () => {
    writeProjectProfile(projectRoot);

    const report = await new FrameworkUpdater().run(projectRoot);

    expect(report.regenerated).toContain('CLAUDE.md');
    expect(report.regenerated.some((path) => path.includes('/skills/'))).toBe(false);
    expect(report.regenerated.some((path) => path.includes('/agents/'))).toBe(false);
    expect(report.regenerated).not.toContain('.claude/skills/request-classifier/SKILL.md');
    expect(report.regenerated).not.toContain('.claude/agents/router.md');
  });
});
