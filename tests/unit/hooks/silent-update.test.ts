import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

const SCRIPT = join(process.cwd(), 'runtime/hooks/silent-update.mjs');

const itPosix = process.platform === 'win32' ? it.skip : it;

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-silent-update-'));
}

function writeVersionFile(root: string, version: string, updatedAt?: string): void {
  const dir = join(root, '.paqad');
  mkdirSync(dir, { recursive: true });
  const updatedAtLine = updatedAt
    ? `updated_at=${updatedAt}`
    : `updated_at=${new Date().toISOString()}`;
  writeFileSync(join(dir, 'framework-version.txt'), `version=${version}\n${updatedAtLine}\n`);
}

function writeFakeNpm(dir: string): void {
  const fakePath = join(dir, 'npm');
  writeFileSync(fakePath, '#!/bin/sh\nexit 0\n');
  chmodSync(fakePath, 0o755);
}

function writeFakeNpmVersion(dir: string, version: string): void {
  const fakePath = join(dir, 'npm');
  writeFileSync(fakePath, `#!/bin/sh\nif [ "$1" = "view" ]; then echo ${version}; fi\nexit 0\n`);
  chmodSync(fakePath, 0o755);
}

const STALE = '2020-01-01T00:00:00Z';

const INHERITED_SESSION_VARS = [
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_SESSION_ID',
  'CLAUDE_PLUGIN_ROOT',
  'CLAUDE_ENV_FILE',
  'PAQAD_FRAMEWORK_HOME',
  'PAQAD_PROJECT_ROOT',
];

async function runHook(
  root: string,
  fakeBinDir?: string,
  options: { input?: string; env?: Record<string, string | undefined> } = {},
) {
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const inherited: Record<string, string | undefined> = { ...process.env };
  for (const name of INHERITED_SESSION_VARS) delete inherited[name];
  return execa('node', [SCRIPT], {
    reject: false,
    cwd: root,
    input: options.input ?? '',
    env: {
      ...inherited,
      ...(fakeBinDir ? { PATH: `${fakeBinDir}:${process.env.PATH}` } : {}),
      HOME: home,
      USERPROFILE: home,
      CLAUDE_PROJECT_DIR: root,
      ...options.env,
    },
    extendEnv: false,
    timeout: 10000,
  });
}

function fakeTickPackage(root: string, state = 'installed'): Record<string, string> {
  const pkg = join(root, 'pkg');
  mkdirSync(join(pkg, 'runtime'), { recursive: true });
  mkdirSync(join(pkg, 'dist', 'cli'), { recursive: true });
  writeFileSync(
    join(pkg, 'dist', 'cli', 'index.js'),
    `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'tick-argv.json'))}, JSON.stringify(process.argv.slice(2)));\n`,
  );
  const home = join(root, 'home');
  mkdirSync(join(home, '.paqad-ai'), { recursive: true });
  writeFileSync(
    join(home, '.paqad-ai', 'plugin-migration.json'),
    JSON.stringify({ state, attempts: 1, version: '1' }),
  );
  return { PAQAD_FRAMEWORK_HOME: join(pkg, 'runtime') };
}

async function readTickArgv(root: string, waitMs = 3000): Promise<string[] | null> {
  const path = join(root, 'tick-argv.json');
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as string[];
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

function readAuditLog(root: string): string {
  const path = join(root, '.paqad', 'logs', 'auto-update.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('silent-update.mjs', () => {
  it('exits 0 when framework-version.txt is missing and cannot be seeded', async () => {
    const root = makeRoot();
    try {
      const emptyHome = join(root, 'no-framework');
      mkdirSync(emptyHome, { recursive: true });
      const result = await runHook(root, undefined, { env: { PAQAD_FRAMEWORK_HOME: emptyHome } });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(root, '.paqad', 'framework-version.txt'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('self-heals: seeds framework-version.txt from the installed package, then exits', async () => {
    const root = makeRoot();
    try {
      const installDir = join(root, 'install');
      const frameworkHome = join(installDir, 'runtime');
      mkdirSync(frameworkHome, { recursive: true });
      writeFileSync(
        join(installDir, 'package.json'),
        JSON.stringify({ name: 'paqad-ai', version: '3.4.5' }),
      );

      const result = await runHook(root, undefined, {
        env: { PAQAD_FRAMEWORK_HOME: frameworkHome },
      });

      expect(result.exitCode).toBe(0);
      const content = readFileSync(join(root, '.paqad', 'framework-version.txt'), 'utf8');
      expect(content).toContain('version=3.4.5');
      expect(content).toContain('updated_at=1970-01-01T00:00:00Z');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 0 when within the interval window (updated_at is now)', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '0.1.0', new Date().toISOString());
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(join(root, '.paqad', '.config'), 'version_check_interval_hours=12\n');

      const result = await runHook(root, undefined, { env: { CLAUDE_PROJECT_DIR: undefined } });
      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 0 when auto-update is opted out in .config', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '0.1.0', STALE);
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(join(root, '.paqad', '.config'), 'auto_update=false\n');

      const result = await runHook(root, undefined, { env: { CLAUDE_PROJECT_DIR: undefined } });
      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does nothing when disabled via .config (no seed, no spawn)', async () => {
    const root = makeRoot();
    try {
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(join(root, '.paqad', '.config'), 'paqad_enable=false\n');

      const frameworkHome = join(root, 'framework-home');
      mkdirSync(frameworkHome, { recursive: true });
      writeFileSync(
        join(frameworkHome, 'package.json'),
        JSON.stringify({ name: 'paqad-ai', version: '3.4.5' }),
      );

      const result = await runHook(root, undefined, {
        env: { PAQAD_FRAMEWORK_HOME: frameworkHome },
      });

      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toBe('');
      expect(existsSync(join(root, '.paqad', 'framework-version.txt'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does nothing when PAQAD_DISABLED=1 (no seed, no spawn)', async () => {
    const root = makeRoot();
    try {
      const result = await runHook(root, undefined, { env: { PAQAD_DISABLED: '1' } });

      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toBe('');
      expect(existsSync(join(root, '.paqad', 'framework-version.txt'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  itPosix('exits 0 when npm returns empty output (simulates registry unreachable)', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '0.1.0', STALE);

      const fakeBinDir = join(root, 'fakebin');
      mkdirSync(fakeBinDir, { recursive: true });
      writeFakeNpm(fakeBinDir);

      const result = await runHook(root, fakeBinDir);
      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  itPosix('exits 0 without spawning when the update lock is already held', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '0.1.0', STALE);
      const lockDir = join(root, '.paqad', 'locks', 'update.lock');
      mkdirSync(lockDir, { recursive: true });

      const fakeBinDir = join(root, 'fakebin');
      mkdirSync(fakeBinDir, { recursive: true });
      writeFakeNpmVersion(fakeBinDir, '999.0.0');

      const result = await runHook(root, fakeBinDir);
      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  itPosix('logs a routine self-update when behind but inside the 2-minor window', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '1.14.0', STALE);
      const fakeBinDir = join(root, 'fakebin');
      mkdirSync(fakeBinDir, { recursive: true });
      writeFakeNpmVersion(fakeBinDir, '1.15.0');

      const result = await runHook(root, fakeBinDir);
      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toMatch(/routine self-update 1\.14\.0 -> 1\.15\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  itPosix('logs a forced self-update when more than two minors behind', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '1.6.0', STALE);
      const fakeBinDir = join(root, 'fakebin');
      mkdirSync(fakeBinDir, { recursive: true });
      writeFakeNpmVersion(fakeBinDir, '1.15.0');

      const result = await runHook(root, fakeBinDir);
      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toMatch(/forced self-update 1\.6\.0 -> 1\.15\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  itPosix('logs a forced self-update when an older major is installed', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '1.99.0', STALE);
      const fakeBinDir = join(root, 'fakebin');
      mkdirSync(fakeBinDir, { recursive: true });
      writeFakeNpmVersion(fakeBinDir, '2.0.0');

      const result = await runHook(root, fakeBinDir);
      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toMatch(/forced self-update 1\.99\.0 -> 2\.0\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  itPosix('does not spawn an update when already on the latest version', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '1.15.0', STALE);
      const fakeBinDir = join(root, 'fakebin');
      mkdirSync(fakeBinDir, { recursive: true });
      writeFakeNpmVersion(fakeBinDir, '1.15.0');

      const result = await runHook(root, fakeBinDir);
      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toBe('');
      expect(readFileSync(join(root, '.paqad', 'framework-version.txt'), 'utf8')).not.toContain(
        STALE,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe('plugin migration tick', () => {
    it('spawns plugin tick --source npm with the payload session id', async () => {
      const root = makeRoot();
      try {
        writeVersionFile(root, '0.1.0', new Date().toISOString());
        const env = fakeTickPackage(root);
        const result = await runHook(root, undefined, {
          input: JSON.stringify({ session_id: 'sess-1', source: 'startup' }),
          env,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
        expect(await readTickArgv(root)).toEqual([
          'plugin',
          'tick',
          '--source',
          'npm',
          '--session',
          'sess-1',
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('reports source plugin when the plugin claimed the session (still before step-aside)', async () => {
      const root = makeRoot();
      try {
        writeVersionFile(root, '0.1.0', new Date().toISOString());
        const env = fakeTickPackage(root);
        mkdirSync(join(root, '.paqad', 'session', 'plugin-active.d'), { recursive: true });
        writeFileSync(join(root, '.paqad', 'session', 'plugin-active.d', 'sess-2'), 'x');
        await runHook(root, undefined, {
          input: JSON.stringify({ session_id: 'sess-2', source: 'resume' }),
          env: { ...env, CLAUDE_SESSION_ID: 'sess-2', CLAUDE_PLUGIN_ROOT: undefined },
        });
        expect(await readTickArgv(root)).toEqual([
          'plugin',
          'tick',
          '--source',
          'plugin',
          '--session',
          'sess-2',
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('spawns nothing for a compact SessionStart (AC-11)', async () => {
      const root = makeRoot();
      try {
        writeVersionFile(root, '0.1.0', new Date().toISOString());
        const env = fakeTickPackage(root);
        await runHook(root, undefined, {
          input: JSON.stringify({ session_id: 'sess-3', source: 'compact' }),
          env,
        });
        expect(await readTickArgv(root, 750)).toBeNull();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('spawns nothing outside Claude Code (CLAUDE_PROJECT_DIR unset, e.g. Codex) (AC-11)', async () => {
      const root = makeRoot();
      try {
        writeVersionFile(root, '0.1.0', new Date().toISOString());
        const env = fakeTickPackage(root);
        await runHook(root, undefined, {
          input: JSON.stringify({ session_id: 'sess-4', source: 'startup' }),
          env: { ...env, CLAUDE_PROJECT_DIR: undefined, PAQAD_PROJECT_ROOT: root },
        });
        expect(await readTickArgv(root, 750)).toBeNull();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('spawns nothing when the machine has no migration in flight', async () => {
      const root = makeRoot();
      try {
        writeVersionFile(root, '0.1.0', new Date().toISOString());
        const env = fakeTickPackage(root, 'done');
        const result = await runHook(root, undefined, {
          input: JSON.stringify({ session_id: 'sess-5' }),
          env,
        });
        expect(result.exitCode).toBe(0);
        expect(await readTickArgv(root, 750)).toBeNull();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('exits 0 silently on a malformed payload', async () => {
      const root = makeRoot();
      try {
        writeVersionFile(root, '0.1.0', new Date().toISOString());
        const env = fakeTickPackage(root);
        const result = await runHook(root, undefined, { input: '{ not json', env });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
        expect(await readTickArgv(root)).toEqual(['plugin', 'tick', '--source', 'npm']);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  it.skipIf(process.platform === 'win32')('script file exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const stat = statSync(SCRIPT);
    expect(stat.mode & 0o100).toBe(0o100);
  });
});
