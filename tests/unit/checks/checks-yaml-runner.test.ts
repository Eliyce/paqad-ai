import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runChecks } from '@/checks/run-checks.js';
import { PATHS } from '@/core/constants/paths.js';
import { migrateTeamConfig } from '@/core/team-config-migrate.js';
import type { FeatureDevelopmentChecksPolicy } from '@/core/types/feature-development-policy.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import {
  defaultFeatureDevelopmentPolicy,
  loadFeatureDevelopmentPolicy,
  resolveFeatureDevelopmentCheckCommands,
} from '@/pipeline/feature-development-policy.js';

const CLOCK = { nowMs: () => Date.now(), now: () => '2026-01-01T00:00:00.000Z' };
const OS = { availableParallelism: 8, totalmem: 64 * 1024 ** 3 };
const PROFILE = {
  commands: {
    format: 'pnpm format',
    test: 'pnpm test',
    build: 'pnpm build',
    lint: 'pnpm lint',
  },
};

interface OldChecksFields {
  use_project_profile_commands?: boolean;
  commands?: string[];
  shell_commands?: string[];
  block_on_failure?: boolean;
}

// How the old workflow file's stages.checks.checks fields were merged over the
// defaults before #791 (mergeFeatureDevelopmentPolicy, removed in 4b878593).
function oldChecks(raw: OldChecksFields): FeatureDevelopmentChecksPolicy {
  const base = defaultFeatureDevelopmentPolicy().stages.checks.checks!;
  return {
    use_project_profile_commands: raw.use_project_profile_commands ?? true,
    commands: [...new Set([...base.commands, ...(raw.commands ?? [])])],
    shell_commands: [...new Set([...base.shell_commands, ...(raw.shell_commands ?? [])])],
    block_on_failure: raw.block_on_failure === true || base.block_on_failure,
  } as FeatureDevelopmentChecksPolicy;
}

function expectedCommands(checks: FeatureDevelopmentChecksPolicy): string[] {
  return resolveFeatureDevelopmentCheckCommands(checks, PROFILE as never)
    .commands.map((command) => command.command)
    .sort();
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-checks-yaml-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.PROJECT_PROFILE), YAML.stringify(PROFILE));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(rel: string, value: unknown): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : YAML.stringify(value));
}

async function run(failing: string | null = null): Promise<{ ran: string[]; passed: boolean }> {
  const ran: string[] = [];
  const shell: DeliveryShell = {
    async run(bin, args) {
      const command = [bin, ...args].join(' ');
      ran.push(command);
      return { stdout: '', stderr: '', exitCode: command === failing ? 1 : 0 };
    },
  };
  const result = await runChecks({ projectRoot: root, shell, osFacts: OS, ...CLOCK });
  return { ran: ran.sort(), passed: result.passed };
}

describe('checks.yaml drives the checks runner as the old workflow fields did (AC-56)', () => {
  it('AC-56: commands.from_project_profile and commands.extra run the same commands as the old commands and shell_commands', async () => {
    write('.paqad/configs/feature-development/checks.yaml', {
      commands: {
        from_project_profile: ['format', 'test', 'build', 'lint'],
        extra: { 'lint-js': 'pnpm lint:js' },
      },
      on_failure: 'block',
    });
    const old = oldChecks({ commands: ['lint'], shell_commands: ['pnpm lint:js'] });

    const checks = loadFeatureDevelopmentPolicy(root).policy.stages.checks.checks!;
    expect(checks).toEqual(old);
    expect((await run()).ran).toEqual(expectedCommands(old));
    expect((await run()).ran).toEqual(
      ['pnpm build', 'pnpm format', 'pnpm lint', 'pnpm lint:js', 'pnpm test'].sort(),
    );
  });

  it('AC-56: from_project_profile [] runs none of the profile commands, as use_project_profile_commands false did', async () => {
    write('.paqad/configs/feature-development/checks.yaml', {
      commands: { from_project_profile: [], extra: { 'command-1': 'pnpm lint:js' } },
    });
    const old = oldChecks({
      use_project_profile_commands: false,
      shell_commands: ['pnpm lint:js'],
    });

    const checks = loadFeatureDevelopmentPolicy(root).policy.stages.checks.checks!;
    expect(checks.use_project_profile_commands).toBe(false);
    expect((await run()).ran).toEqual(expectedCommands(old));
    expect((await run()).ran).toEqual(['pnpm lint:js']);
  });

  it('AC-56: on_failure sets block_on_failure, and a red command fails the run under either value, as before', async () => {
    for (const [onFailure, block] of [
      ['block', true],
      ['warn', false],
    ] as const) {
      write('.paqad/configs/feature-development/checks.yaml', { on_failure: onFailure });
      const checks = loadFeatureDevelopmentPolicy(root).policy.stages.checks.checks!;
      expect([onFailure, checks.block_on_failure]).toEqual([onFailure, block]);
      const result = await run('pnpm build');
      expect([onFailure, result.passed]).toEqual([onFailure, false]);
      expect(result.ran).toEqual(expectedCommands(oldChecks({})));
    }
  });

  it('AC-56: an old workflow file migrated to checks.yaml runs the same commands as before', async () => {
    const fields: OldChecksFields = {
      use_project_profile_commands: true,
      commands: ['format', 'test', 'build', 'lint'],
      shell_commands: ['pnpm lint:js', 'pnpm audit'],
      block_on_failure: true,
    };
    write(join(PATHS.WORKFLOWS_DIR, 'feature-development.yaml'), {
      schema_version: '1',
      merge_mode: 'append',
      stages: { checks: { checks: fields } },
    });
    migrateTeamConfig(root, { version: '1.117.0' });

    const checks = loadFeatureDevelopmentPolicy(root).policy.stages.checks.checks!;
    expect(checks).toEqual(oldChecks(fields));
    expect((await run()).ran).toEqual(expectedCommands(oldChecks(fields)));
  });

  it('AC-56: an old workflow file that turned the profile commands off still runs only its shell commands', async () => {
    const fields: OldChecksFields = {
      use_project_profile_commands: false,
      commands: ['format', 'test'],
      shell_commands: ['pnpm lint:js'],
    };
    write(join(PATHS.WORKFLOWS_DIR, 'feature-development.yaml'), {
      schema_version: '1',
      stages: { checks: { checks: fields } },
    });
    migrateTeamConfig(root, { version: '1.117.0' });

    expect((await run()).ran).toEqual(expectedCommands(oldChecks(fields)));
    expect((await run()).ran).toEqual(['pnpm lint:js']);
  });
});
