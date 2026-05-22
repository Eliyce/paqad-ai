import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { createCapabilitiesCommand } from '@/cli/commands/capabilities.js';
import { writeProjectProfile } from '@/core/project-profile.js';

describe('capabilities command', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-capabilities-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeProjectProfile(projectRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content', 'coding', 'security'],
      stack_profile: {
        frameworks: ['laravel'],
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
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('removes coding and cascades security removal', async () => {
    const command = createCapabilitiesCommand();
    await command.parseAsync(
      ['node', 'capabilities', 'remove', 'coding', '--project-root', projectRoot],
      {
        from: 'node',
      },
    );

    const profile = YAML.parse(
      readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8'),
    ) as {
      active_capabilities: string[];
      stack_profile?: unknown;
    };
    expect(profile.active_capabilities).toEqual(['content']);
    expect(profile.stack_profile).toBeUndefined();
  });

  it('prevents removing content', async () => {
    const command = createCapabilitiesCommand();
    await expect(
      command.parseAsync(
        ['node', 'capabilities', 'remove', 'content', '--project-root', projectRoot],
        {
          from: 'node',
        },
      ),
    ).rejects.toThrow('content capability cannot be removed');
  });

  it('rejects unknown capability names', async () => {
    const command = createCapabilitiesCommand();
    await expect(
      command.parseAsync(
        ['node', 'capabilities', 'add', 'unknown-capability', '--project-root', projectRoot],
        {
          from: 'node',
        },
      ),
    ).rejects.toThrow('Unknown capability "unknown-capability"');
  });

  it('rejects adding dependency-managed security directly', async () => {
    const command = createCapabilitiesCommand();
    await expect(
      command.parseAsync(
        ['node', 'capabilities', 'add', 'security', '--project-root', projectRoot],
        {
          from: 'node',
        },
      ),
    ).rejects.toThrow(
      'Capability "security" is dependency-managed and cannot be changed directly. Manage "coding" instead.',
    );
  });

  it('rejects removing dependency-managed security directly', async () => {
    const command = createCapabilitiesCommand();
    await expect(
      command.parseAsync(
        ['node', 'capabilities', 'remove', 'security', '--project-root', projectRoot],
        {
          from: 'node',
        },
      ),
    ).rejects.toThrow(
      'Capability "security" is dependency-managed and cannot be changed directly. Manage "coding" instead.',
    );
  });
});
