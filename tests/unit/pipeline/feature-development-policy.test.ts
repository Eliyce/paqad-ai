import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  defaultFeatureDevelopmentPolicy,
  loadFeatureDevelopmentPolicy,
  resolveFeatureDevelopmentCheckCommands,
} from '@/pipeline/feature-development-policy.js';

describe('feature development policy', () => {
  it('returns framework defaults when the project policy file is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy).toEqual(defaultFeatureDevelopmentPolicy());
    expect(result.warnings).toEqual([]);
  });

  it('defines ticket_intake as the first stage and delivery as the last stage', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    const stageNames = Object.keys(policy.stages);
    expect(stageNames[0]).toBe('ticket_intake');
    expect(stageNames[stageNames.length - 1]).toBe('delivery');
    expect(policy.stages.ticket_intake.artifacts).toEqual(
      expect.arrayContaining(['refined ticket', 'resolved decision packets']),
    );
    expect(policy.stages.delivery.artifacts).toEqual(
      expect.arrayContaining(['branch', 'commit', 'pull request']),
    );
    expect(policy.stages.delivery.escalation.remote_failure).toBe('stop');
  });

  it('merges project overrides into the new ticket_intake and delivery stages', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));
    mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
      YAML.stringify({
        schema_version: '1',
        stages: {
          ticket_intake: {
            instructions: ['Always pull the ticket via the Linear MCP.'],
          },
          delivery: {
            instructions: ['Require a draft PR for changes touching migrations.'],
          },
        },
      }),
    );

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy.stages.ticket_intake.instructions).toEqual(
      expect.arrayContaining(['Always pull the ticket via the Linear MCP.']),
    );
    expect(result.policy.stages.delivery.instructions).toEqual(
      expect.arrayContaining(['Require a draft PR for changes touching migrations.']),
    );
  });

  it('merges project reads and checks with framework defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));
    mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
      YAML.stringify({
        schema_version: '1',
        stages: {
          planning: {
            read: ['docs/custom/**'],
          },
          checks: {
            checks: {
              commands: ['lint'],
              shell_commands: ['pnpm typecheck'],
            },
          },
          review: {
            strictness: {
              require_review: false,
            },
          },
        },
      }),
    );

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy.stages.planning.read).toEqual(
      expect.arrayContaining(['docs/modules/**', 'docs/instructions/**', 'docs/custom/**']),
    );
    expect(result.policy.stages.checks.checks?.commands).toEqual(
      expect.arrayContaining(['format', 'test', 'build', 'lint']),
    );
    expect(result.policy.stages.checks.checks?.shell_commands).toContain('pnpm typecheck');
    expect(result.policy.stages.review.strictness.require_review).toBe(true);
  });

  it('falls back to defaults with warnings when the project policy is invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-feature-policy-'));
    mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
      YAML.stringify({
        schema_version: '2',
      }),
    );

    const result = loadFeatureDevelopmentPolicy(root);

    expect(result.policy).toEqual(defaultFeatureDevelopmentPolicy());
    expect(result.warnings[0]).toContain('is invalid');
  });

  it('resolves logical check commands from the project profile and appends shell commands', () => {
    const resolved = resolveFeatureDevelopmentCheckCommands(
      {
        use_project_profile_commands: true,
        commands: ['format', 'build'],
        shell_commands: ['pnpm typecheck'],
        block_on_failure: true,
      },
      {
        commands: {
          install: 'pnpm install',
          dev: 'pnpm dev',
          test: 'pnpm test',
          test_single: 'pnpm test -- <pattern>',
          lint: 'pnpm lint',
          format: 'pnpm format',
          migrate: 'echo migrate',
          build: 'pnpm build',
        },
      },
    );

    expect(resolved.commands).toEqual([
      {
        logical_command: 'format',
        command: 'pnpm format',
        source: 'project-profile',
      },
      {
        logical_command: 'build',
        command: 'pnpm build',
        source: 'project-profile',
      },
      {
        logical_command: null,
        command: 'pnpm typecheck',
        source: 'policy',
      },
    ]);
    expect(resolved.warnings).toEqual([]);
  });
});
