import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { VERSION } from '@/index.js';
import { FrameworkUpdater } from '@/update/index.js';

describe('FrameworkUpdater', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-update-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad/framework-version.txt'),
      'version=0.0.0\nupdated_at=2020-01-01T00:00:00.000Z\n',
    );
    writeFileSync(
      join(projectRoot, '.paqad/project-profile.yaml'),
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
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('updates framework-managed artifacts and reports version changes', async () => {
    writeFileSync(
      join(projectRoot, '.paqad/onboarding-manifest.json'),
      JSON.stringify(
        {
          framework_version: '0.0.0',
          adapter: 'claude-code',
          project_root: projectRoot,
          profile: {},
          detected: null,
          generated_at: new Date().toISOString(),
          generated_artifacts: [{ path: 'CLAUDE.md', auto_update: true }],
        },
        null,
        2,
      ),
    );
    writeFileSync(join(projectRoot, 'CLAUDE.md'), 'old');

    const updater = new FrameworkUpdater({
      generateCandidates: async () => [
        {
          path: 'CLAUDE.md',
          content: 'new',
          autoUpdate: true,
        },
      ],
    });

    const report = await updater.run(projectRoot);

    expect(report.previous_version).toBe('0.0.0');
    expect(report.target_version).toBe(VERSION);
    expect(report.regenerated).toEqual(['CLAUDE.md']);
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toBe('new');
    const versionFileContent = readFileSync(
      join(projectRoot, '.paqad/framework-version.txt'),
      'utf8',
    );
    expect(versionFileContent).toMatch(/^version=/m);
    expect(versionFileContent).toContain(`version=${VERSION}`);
    expect(versionFileContent).toMatch(/^updated_at=/m);
  });

  it('skips user-managed artifacts and produces a diff report', async () => {
    writeFileSync(
      join(projectRoot, '.paqad/onboarding-manifest.json'),
      JSON.stringify(
        {
          framework_version: '0.0.0',
          adapter: 'claude-code',
          project_root: projectRoot,
          profile: {},
          detected: null,
          generated_at: new Date().toISOString(),
          generated_artifacts: [{ path: 'docs/rules/team.md', auto_update: false }],
        },
        null,
        2,
      ),
    );
    mkdirSync(join(projectRoot, 'docs/rules'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs/rules/team.md'), 'current rule');

    const updater = new FrameworkUpdater({
      generateCandidates: async () => [
        {
          path: 'docs/rules/team.md',
          content: 'framework rule',
          autoUpdate: true,
        },
        {
          path: 'scripts/new-script.sh',
          content: '#!/usr/bin/env bash\necho ok\n',
          autoUpdate: true,
          executable: true,
        },
      ],
    });

    const report = await updater.run(projectRoot);

    expect(report.regenerated).toEqual(['scripts/new-script.sh']);
    expect(report.new_scripts).toEqual(['scripts/new-script.sh']);
    expect(report.skipped).toEqual([
      {
        path: 'docs/rules/team.md',
        before: 'current rule',
        after: 'framework rule',
      },
    ]);
    expect(readFileSync(join(projectRoot, 'docs/rules/team.md'), 'utf8')).toBe('current rule');
    expect(existsSync(join(projectRoot, 'scripts/new-script.sh'))).toBe(true);
  });
});
