import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { execa } from 'execa';

import { VERSION } from '@/index.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';

const cliPath = join(process.cwd(), 'dist/cli/index.js');
const buildLockRoot = join(process.cwd(), '.tmp');
const buildLockDir = join(process.cwd(), '.tmp', 'built-cli.lock');

async function builtCliIsCurrent(): Promise<boolean> {
  if (!existsSync(cliPath)) {
    return false;
  }
  // A dist built from an older version makes `--version` assertions flake;
  // treat a version mismatch the same as a missing build.
  try {
    const { stdout } = await execa('node', [cliPath, '--version'], { cwd: process.cwd() });
    return stdout.trim() === VERSION;
  } catch {
    return false;
  }
}

async function ensureBuiltCli(): Promise<void> {
  if ((await builtCliIsCurrent()) && !existsSync(buildLockDir)) {
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
      if ((await builtCliIsCurrent()) && !existsSync(buildLockDir)) {
        return;
      }
      await sleep(100);
    }
  }

  try {
    if (!(await builtCliIsCurrent())) {
      await execa('pnpm', ['run', 'build'], {
        cwd: process.cwd(),
      });
    }
  } finally {
    rmSync(buildLockDir, { recursive: true, force: true });
  }
}

describe('package publishing readiness', () => {
  beforeAll(async () => {
    await ensureBuiltCli();
  });

  it(
    'exposes a working built cli and pack manifest',
    async () => {
      const npmCache = mkdtempSync(join(tmpdir(), 'paqad-npm-cache-'));
      const version = await execa('node', [cliPath, '--version'], {
        cwd: process.cwd(),
      });
      const help = await execa('node', [cliPath, '--help'], {
        cwd: process.cwd(),
      });
      const pack = await execa('npm', ['pack', '--json', '--dry-run'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          npm_config_cache: npmCache,
        },
      });
      const files = JSON.parse(pack.stdout)[0].files as Array<{ path: string }>;

      expect(version.stdout.trim()).toBe(VERSION);
      expect(help.stdout).toContain('install');
      expect(help.stdout).toContain('doctor');
      expect(help.stdout).toContain('onboard');
      expect(files.some((file) => file.path.startsWith('runtime/'))).toBe(true);
      expect(files.some((file) => file.path.startsWith('tests/'))).toBe(false);
      rmSync(npmCache, { recursive: true, force: true });
      // npm pack --dry-run over the runtime/ tree is much slower on Windows
      // runners; mirror the platform-aware defaults in vitest.config.ts.
      // 30s elsewhere: two CLI spawns plus the pack scan can exceed 15s on a
      // cold container running the suite at full parallelism.
    },
    process.platform === 'win32' ? 60_000 : 30_000,
  );

  it('supports install and doctor flows from the built cli', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-package-'));
    process.env.PAQAD_FRAMEWORK_HOME = join(projectRoot, '.framework-home');

    try {
      await execa('node', [cliPath, 'install', '--project-root', projectRoot], {
        cwd: projectRoot,
      });
      const installPath = readFileSync(join(projectRoot, '.paqad/framework-path.txt'), 'utf8');
      expect(installPath.trim()).toBe('$PAQAD_FRAMEWORK_HOME');

      await execa('node', [cliPath, 'onboard', '--project-root', projectRoot], {
        cwd: projectRoot,
      });

      const doctor = await execa('node', [cliPath, 'doctor', '--project-root', projectRoot], {
        cwd: projectRoot,
      });

      expect(doctor.stdout).toContain('"overall_status"');
    } finally {
      delete process.env.PAQAD_FRAMEWORK_HOME;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('reports efficiency usage metrics from observed artifacts only in built doctor output', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-package-doctor-'));
    process.env.PAQAD_FRAMEWORK_HOME = join(projectRoot, '.framework-home');

    try {
      await execa('node', [cliPath, 'install', '--project-root', projectRoot], {
        cwd: projectRoot,
      });
      await execa('node', [cliPath, 'onboard', '--project-root', projectRoot], {
        cwd: projectRoot,
      });

      const profile = readProjectProfile(projectRoot);
      if (profile === null) {
        throw new Error('Expected onboard to create a project profile');
      }

      writeProjectProfile(projectRoot, {
        ...profile,
        efficiency: {
          ...profile.efficiency,
          mcp_first: true,
        },
      });

      rmSync(join(projectRoot, '.paqad', 'cache', 'skill-results'), {
        recursive: true,
        force: true,
      });
      mkdirSync(join(projectRoot, '.paqad', 'cache', 'skill-results'), { recursive: true });

      const syntheticOnlyDoctor = await execa(
        'node',
        [cliPath, 'doctor', '--project-root', projectRoot],
        {
          cwd: projectRoot,
        },
      );

      expect(JSON.parse(syntheticOnlyDoctor.stdout).efficiency).toEqual({
        context_hit_rate: 0,
        skill_cache_hit_rate: 0,
        mcp_usage_rate: 0,
      });

      mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
      writeFileSync(
        join(projectRoot, '.paqad', 'session', 'context-hit-log.json'),
        JSON.stringify({ hit_rate: 0.4 }),
      );
      writeFileSync(
        join(projectRoot, '.paqad', 'cache', 'skill-results', '.stats.json'),
        JSON.stringify({ hits: 3, misses: 1 }),
      );

      const observedDoctor = await execa(
        'node',
        [cliPath, 'doctor', '--project-root', projectRoot],
        {
          cwd: projectRoot,
        },
      );

      expect(JSON.parse(observedDoctor.stdout).efficiency).toEqual({
        context_hit_rate: 0.4,
        skill_cache_hit_rate: 0.75,
        mcp_usage_rate: 0,
      });
    } finally {
      delete process.env.PAQAD_FRAMEWORK_HOME;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
