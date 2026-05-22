import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { execa } from 'execa';

const cliPath = join(process.cwd(), 'dist/cli/index.js');
const buildLockRoot = join(process.cwd(), '.tmp');
const buildLockDir = join(process.cwd(), '.tmp', 'built-cli.lock');

async function ensureBuiltCli(): Promise<void> {
  if (existsSync(cliPath) && !existsSync(buildLockDir)) {
    return;
  }

  mkdirSync(buildLockRoot, { recursive: true });

  while (true) {
    try {
      mkdirSync(buildLockDir, { recursive: false });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      if (existsSync(cliPath) && !existsSync(buildLockDir)) {
        return;
      }
      await sleep(100);
    }
  }

  try {
    if (!existsSync(cliPath)) {
      await execa('pnpm', ['run', 'build'], {
        cwd: process.cwd(),
      });
    }
  } finally {
    rmSync(buildLockDir, { recursive: true, force: true });
  }
}

describe('CLI interactions — end-to-end', () => {
  beforeAll(async () => {
    await ensureBuiltCli();
  });

  it('supports user-facing capabilities management against an onboarded project', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-cli-capabilities-'));
    process.env.PAQAD_FRAMEWORK_HOME = join(projectRoot, '.framework-home');

    try {
      await execa('node', [cliPath, 'install', '--project-root', projectRoot], {
        cwd: projectRoot,
      });
      await execa(
        'node',
        [
          cliPath,
          'onboard',
          '--project-root',
          projectRoot,
          '--stack',
          'laravel',
          '--providers',
          'claude-code',
        ],
        { cwd: projectRoot },
      );

      const available = await execa('node', [cliPath, 'capabilities', 'available'], {
        cwd: projectRoot,
      });
      expect(available.stdout).toContain('content');
      expect(available.stdout).toContain('coding');
      expect(available.stdout).not.toContain('security');

      const initial = await execa(
        'node',
        [cliPath, 'capabilities', 'list', '--project-root', projectRoot],
        { cwd: projectRoot },
      );
      expect(initial.stdout.trim().split('\n')).toEqual(['content', 'coding', 'security']);

      await execa(
        'node',
        [cliPath, 'capabilities', 'remove', 'coding', '--project-root', projectRoot],
        { cwd: projectRoot },
      );
      const afterRemove = await execa(
        'node',
        [cliPath, 'capabilities', 'list', '--project-root', projectRoot],
        { cwd: projectRoot },
      );
      expect(afterRemove.stdout.trim()).toBe('content');

      await execa(
        'node',
        [cliPath, 'capabilities', 'add', 'coding', '--project-root', projectRoot],
        { cwd: projectRoot },
      );
      const afterAdd = await execa(
        'node',
        [cliPath, 'capabilities', 'list', '--project-root', projectRoot],
        { cwd: projectRoot },
      );
      expect(afterAdd.stdout.trim().split('\n')).toEqual(['content', 'coding', 'security']);

      await expect(
        execa('node', [cliPath, 'capabilities', 'add', 'security', '--project-root', projectRoot], {
          cwd: projectRoot,
        }),
      ).rejects.toThrow('dependency-managed');

      await expect(
        execa(
          'node',
          [cliPath, 'capabilities', 'remove', 'security', '--project-root', projectRoot],
          { cwd: projectRoot },
        ),
      ).rejects.toThrow('dependency-managed');
    } finally {
      delete process.env.PAQAD_FRAMEWORK_HOME;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  }, 15000);

  it('supports pack scaffolding, validation, installation, and listing from the built cli', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-cli-packs-'));
    const destination = join(projectRoot, 'generated-packs');

    try {
      const created = await execa(
        'node',
        [
          cliPath,
          'packs',
          'create',
          'billing-tools',
          '--destination',
          destination,
          '--ecosystem',
          'node',
          '--tier',
          'framework',
        ],
        { cwd: projectRoot },
      );

      const packRoot = created.stdout.trim();
      expect(existsSync(packRoot)).toBe(true);
      expect(readFileSync(join(packRoot, 'pack.yaml'), 'utf8')).toContain('name: billing-tools');

      const validation = await execa('node', [cliPath, 'packs', 'validate', packRoot], {
        cwd: projectRoot,
      });
      expect(JSON.parse(validation.stdout)).toMatchObject({
        name: 'billing-tools',
        valid: true,
      });

      const install = await execa(
        'node',
        [
          cliPath,
          'packs',
          'install',
          packRoot,
          '--project-root',
          projectRoot,
          '--scope',
          'project',
        ],
        { cwd: projectRoot },
      );
      expect(JSON.parse(install.stdout)).toMatchObject({
        name: 'billing-tools',
      });

      const listed = await execa(
        'node',
        [cliPath, 'packs', 'list', '--project-root', projectRoot, '--json'],
        { cwd: projectRoot },
      );
      expect(JSON.parse(listed.stdout)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'billing-tools',
            tier: 'framework',
            effective_source: 'project',
          }),
        ]),
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('warns on unsupported flags and preserves onboarding compatibility aliases', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-cli-flags-'));
    process.env.PAQAD_FRAMEWORK_HOME = join(projectRoot, '.framework-home');

    try {
      await execa('node', [cliPath, 'install', '--project-root', projectRoot], {
        cwd: projectRoot,
      });

      const onboard = await execa(
        'node',
        [
          cliPath,
          'onboard',
          '--project-root',
          projectRoot,
          '--stack',
          'laravel',
          '--provider',
          'claude-code',
          '--dry-run',
        ],
        { cwd: projectRoot },
      );

      expect(onboard.stderr).toContain("warning: treating '--provider' as '--providers'");
      expect(onboard.stderr).toContain("warning: ignoring unsupported option '--dry-run'");
      expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);

      const available = await execa(
        'node',
        [cliPath, 'capabilities', 'available', '--stack', 'laravel'],
        { cwd: projectRoot },
      );

      expect(available.stderr).toContain(
        "warning: ignoring unsupported option '--stack' for command 'capabilities available'",
      );
      expect(available.stdout).toContain('coding');
    } finally {
      delete process.env.PAQAD_FRAMEWORK_HOME;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
