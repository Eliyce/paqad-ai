import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

const SCRIPT = join(process.cwd(), 'runtime/hooks/silent-update.sh');

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

function writeProfile(root: string, yaml: string): void {
  const dir = join(root, '.paqad');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'project-profile.yaml'), yaml);
}

/** Create a fake `npm` shim that exits 0 but produces no output. */
function writeFakeNpm(dir: string): void {
  const fakePath = join(dir, 'npm');
  writeFileSync(fakePath, '#!/bin/sh\nexit 0\n');
  chmodSync(fakePath, 0o755);
}

describe('silent-update.sh', () => {
  it('exits 0 when framework-version.txt is missing', async () => {
    const root = makeRoot();
    try {
      const result = await execa('bash', [SCRIPT], {
        reject: false,
        cwd: root,
      });
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 0 when within the interval window (updated_at is now)', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '0.1.0', new Date().toISOString());
      writeProfile(root, 'efficiency:\n  version_check_interval_hours: 12\n');

      const result = await execa('bash', [SCRIPT], {
        reject: false,
        cwd: root,
      });
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 0 when skip_version_check is true', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '0.1.0', '2020-01-01T00:00:00Z');
      writeProfile(root, 'efficiency:\n  skip_version_check: true\n');

      const result = await execa('bash', [SCRIPT], {
        reject: false,
        cwd: root,
      });
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 0 when npm returns empty output (simulates registry unreachable)', async () => {
    const root = makeRoot();
    try {
      writeVersionFile(root, '0.1.0', '2020-01-01T00:00:00Z');

      // Prepend a dir with a fake npm that exits 0 but prints nothing
      const fakeBinDir = join(root, 'fakebin');
      mkdirSync(fakeBinDir, { recursive: true });
      writeFakeNpm(fakeBinDir);

      const result = await execa('bash', [SCRIPT], {
        reject: false,
        cwd: root,
        env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
      });
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exits 0 when a concurrent lockfile is held', async () => {
    const root = makeRoot();
    const locksDir = join(root, '.paqad', 'locks');
    mkdirSync(locksDir, { recursive: true });
    const lockfile = join(locksDir, 'update.lock');

    // Hold the lock in a background bash process
    const holder = execa('bash', ['-c', `exec 200>"${lockfile}"; flock -e 200; sleep 10`], {
      reject: false,
      cwd: root,
    });

    try {
      writeVersionFile(root, '0.1.0', '2020-01-01T00:00:00Z');

      // Give the holder time to acquire the lock
      await new Promise((r) => setTimeout(r, 300));

      // Provide a fake npm that returns a higher version to ensure we reach the lock check
      const fakeBinDir = join(root, 'fakebin');
      mkdirSync(fakeBinDir, { recursive: true });
      writeFileSync(join(fakeBinDir, 'npm'), '#!/bin/sh\necho 999.0.0\n');
      chmodSync(join(fakeBinDir, 'npm'), 0o755);

      const result = await execa('bash', [SCRIPT], {
        reject: false,
        cwd: root,
        env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
        timeout: 10000,
      });

      expect(result.exitCode).toBe(0);
    } finally {
      holder.kill();
      await holder.catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
    }
  }, 15000);

  it('script file exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const stat = statSync(SCRIPT);
    expect(stat.mode & 0o100).toBe(0o100);
  });
});
