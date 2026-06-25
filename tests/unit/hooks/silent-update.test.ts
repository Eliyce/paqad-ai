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

// The npm-dependent paths drive a fake `npm` via a POSIX `#!/bin/sh` shim and the
// hook's shell-resolved `npm` lookup, which only behaves on POSIX. On Windows the
// hook would hit the real npm; skip those cases there (matching the .sh suite,
// which required bash). The seed/interval/skip paths need no npm and run anywhere.
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

/** Create a fake `npm` shim that exits 0 but produces no output. */
function writeFakeNpm(dir: string): void {
  const fakePath = join(dir, 'npm');
  writeFileSync(fakePath, '#!/bin/sh\nexit 0\n');
  chmodSync(fakePath, 0o755);
}

/**
 * Create a fake `npm` that prints `version` for `npm view` and exits 0 for
 * everything else (so the backgrounded `npm install -g` is a harmless no-op).
 */
function writeFakeNpmVersion(dir: string, version: string): void {
  const fakePath = join(dir, 'npm');
  writeFileSync(fakePath, `#!/bin/sh\nif [ "$1" = "view" ]; then echo ${version}; fi\nexit 0\n`);
  chmodSync(fakePath, 0o755);
}

const STALE = '2020-01-01T00:00:00Z';

async function runHook(root: string, fakeBinDir?: string) {
  return execa('node', [SCRIPT], {
    reject: false,
    cwd: root,
    env: {
      ...process.env,
      ...(fakeBinDir ? { PATH: `${fakeBinDir}:${process.env.PATH}` } : {}),
      CLAUDE_PROJECT_DIR: root,
    },
    timeout: 10000,
  });
}

function readAuditLog(root: string): string {
  const path = join(root, '.paqad', 'logs', 'auto-update.log');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('silent-update.mjs', () => {
  it('exits 0 when framework-version.txt is missing and cannot be seeded', async () => {
    const root = makeRoot();
    try {
      // Point the framework home at an empty dir so there is no package.json to
      // seed from — the hook must still exit cleanly, exactly as before.
      const emptyHome = join(root, 'no-framework');
      mkdirSync(emptyHome, { recursive: true });
      const result = await execa('node', [SCRIPT], {
        reject: false,
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, PAQAD_FRAMEWORK_HOME: emptyHome },
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(root, '.paqad', 'framework-version.txt'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('self-heals: seeds framework-version.txt from the installed package, then exits', async () => {
    const root = makeRoot();
    try {
      // A teammate who never onboarded has no local version file. Point the
      // framework home at a fake install carrying a version.
      const frameworkHome = join(root, 'framework-home');
      mkdirSync(frameworkHome, { recursive: true });
      writeFileSync(
        join(frameworkHome, 'package.json'),
        JSON.stringify({ name: 'paqad-ai', version: '3.4.5' }),
      );

      const result = await execa('node', [SCRIPT], {
        reject: false,
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, PAQAD_FRAMEWORK_HOME: frameworkHome },
      });

      expect(result.exitCode).toBe(0);
      const content = readFileSync(join(root, '.paqad', 'framework-version.txt'), 'utf8');
      expect(content).toContain('version=3.4.5');
      // Seeded at the epoch so the NEXT session's interval check fires at once.
      expect(content).toContain('updated_at=1970-01-01T00:00:00Z');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 0 when within the interval window (updated_at is now)', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '0.1.0', new Date().toISOString());
      // The interval throttle now reads VERSION_CHECK_INTERVAL_HOURS from
      // `.paqad/.config` (no longer efficiency.version_check_interval_hours).
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(join(root, '.paqad', '.config'), 'VERSION_CHECK_INTERVAL_HOURS=12\n');

      const result = await execa('node', [SCRIPT], { reject: false, cwd: root });
      expect(result.exitCode).toBe(0);
      // Nothing should have been logged or spawned within the window.
      expect(readAuditLog(root)).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 0 when auto-update is opted out in .config', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '0.1.0', STALE);
      // The opt-out moved from the profile's `skip_version_check` to
      // `AUTO_UPDATE=false` in `.paqad/.config`, which the hook now reads.
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(join(root, '.paqad', '.config'), 'AUTO_UPDATE=false\n');

      const result = await execa('node', [SCRIPT], { reject: false, cwd: root });
      expect(result.exitCode).toBe(0);
      expect(readAuditLog(root)).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Issue #220 — a disabled install must never seed a version file, run a
  // version check, or spawn `npm install -g`. It does nothing, leaving the
  // install exactly as the user left it.
  it('does nothing when disabled via .config (no seed, no spawn)', async () => {
    const root = makeRoot();
    try {
      // The disable signal moved from the profile's `paqad.enabled: false` to
      // `PAQAD_ENABLED=false` in `.paqad/.config`, which the hook reads.
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(join(root, '.paqad', '.config'), 'PAQAD_ENABLED=false\n');

      // No framework-version.txt, but point the framework home at a fake install
      // carrying a version: an ENABLED hook would self-heal and seed one. A
      // disabled hook must leave the install untouched.
      const frameworkHome = join(root, 'framework-home');
      mkdirSync(frameworkHome, { recursive: true });
      writeFileSync(
        join(frameworkHome, 'package.json'),
        JSON.stringify({ name: 'paqad-ai', version: '3.4.5' }),
      );

      const result = await execa('node', [SCRIPT], {
        reject: false,
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, PAQAD_FRAMEWORK_HOME: frameworkHome },
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
      const result = await execa('node', [SCRIPT], {
        reject: false,
        cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, PAQAD_DISABLED: '1' },
      });

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
      // Hold the lock the hook uses (atomic-mkdir directory lock).
      const lockDir = join(root, '.paqad', 'locks', 'update.lock');
      mkdirSync(lockDir, { recursive: true });

      const fakeBinDir = join(root, 'fakebin');
      mkdirSync(fakeBinDir, { recursive: true });
      writeFakeNpmVersion(fakeBinDir, '999.0.0');

      const result = await runHook(root, fakeBinDir);
      expect(result.exitCode).toBe(0);
      // Lock held → no self-update intent recorded.
      expect(readAuditLog(root)).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  itPosix('logs a routine self-update when behind but inside the 2-minor window', async () => {
    const root = makeRoot();
    try {
      // Current 1.14.0, latest 1.15.0 — same major, within the last two minors.
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
      // Current 1.6.0, latest 1.15.0 — same major but far outside the window.
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
      // Current 1.99.0, latest 2.0.0 — older major is always out-of-window.
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
      // updated_at is refreshed away from the stale sentinel value.
      expect(readFileSync(join(root, '.paqad', 'framework-version.txt'), 'utf8')).not.toContain(
        STALE,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('script file exists and is executable', () => {
    // Windows doesn't expose the POSIX +x bit via stat.mode.
    expect(existsSync(SCRIPT)).toBe(true);
    const stat = statSync(SCRIPT);
    expect(stat.mode & 0o100).toBe(0o100);
  });
});
