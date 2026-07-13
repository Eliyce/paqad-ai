import { describe, expect, it } from 'vitest';

import {
  openFeatureReport,
  resolveReportOpenSkip,
  type SpawnFn,
} from '@/feature-evidence/report-open.js';

const ABS = '/tmp/paqad/report.html';

function fakeSpawn(): { fn: SpawnFn; calls: { command: string; args: string[] }[] } {
  const calls: { command: string; args: string[] }[] = [];
  const fn: SpawnFn = (command, args) => {
    calls.push({ command, args });
    return { on: () => ({}), unref: () => {} };
  };
  return { fn, calls };
}

describe('resolveReportOpenSkip', () => {
  it('skips in CI / Actions / Codespaces / remote / SSH', () => {
    expect(resolveReportOpenSkip({ CI: 'true' })).toBe('CI environment');
    expect(resolveReportOpenSkip({ GITHUB_ACTIONS: 'true' })).toBe('GitHub Actions');
    expect(resolveReportOpenSkip({ CODESPACES: 'true' })).toBe('GitHub Codespaces');
    expect(resolveReportOpenSkip({ CLAUDE_CODE_REMOTE: '1' })).toContain('remote');
    expect(resolveReportOpenSkip({ SSH_CONNECTION: 'x' })).toBe('SSH session');
  });

  it('does not skip a clean desktop env', () => {
    expect(resolveReportOpenSkip({}, 'darwin')).toBeNull();
  });

  it('skips a Linux session with no display, but not one with a display', () => {
    expect(resolveReportOpenSkip({}, 'linux')).toBe('no graphical display');
    expect(resolveReportOpenSkip({ DISPLAY: ':0' }, 'linux')).toBeNull();
    expect(resolveReportOpenSkip({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBeNull();
  });
});

describe('openFeatureReport (AC-7)', () => {
  it('invokes the spawn spy with a file:// URL when the env is a clean desktop', () => {
    const { fn, calls } = fakeSpawn();
    const result = openFeatureReport({
      absPath: ABS,
      env: { DISPLAY: ':0' },
      spawnFn: fn,
      platformValue: 'darwin',
    });
    expect(result.opened).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('open');
    expect(calls[0].args[0]).toBe(result.url);
    expect(result.url.startsWith('file://')).toBe(true);
  });

  it('does NOT spawn under SSH or CI — the path is surfaced instead', () => {
    const ssh = fakeSpawn();
    const r1 = openFeatureReport({ absPath: ABS, env: { SSH_CONNECTION: 'x' }, spawnFn: ssh.fn });
    expect(r1.opened).toBe(false);
    expect(r1.reason).toBe('SSH session');
    expect(ssh.calls).toHaveLength(0);

    const ci = fakeSpawn();
    const r2 = openFeatureReport({ absPath: ABS, env: { CI: 'true' }, spawnFn: ci.fn });
    expect(r2.opened).toBe(false);
    expect(ci.calls).toHaveLength(0);
  });

  it('uses the per-OS command (win32 empty-title start, linux xdg-open)', () => {
    const win = fakeSpawn();
    openFeatureReport({
      absPath: ABS,
      env: { DISPLAY: ':0' },
      spawnFn: win.fn,
      platformValue: 'win32',
    });
    expect(win.calls[0].command).toBe('cmd');
    expect(win.calls[0].args.slice(0, 3)).toEqual(['/c', 'start', '""']);

    const lin = fakeSpawn();
    openFeatureReport({
      absPath: ABS,
      env: { DISPLAY: ':0' },
      spawnFn: lin.fn,
      platformValue: 'linux',
    });
    expect(lin.calls[0].command).toBe('xdg-open');
  });

  it('falls back to the real env and platform when neither is injected', () => {
    const { fn, calls } = fakeSpawn();
    // No env and no platformValue → uses process.env + os.platform(). Either it spawns
    // (clean desktop) or it skips (CI/headless runner); both exercise the default paths.
    const result = openFeatureReport({ absPath: ABS, spawnFn: fn });
    if (result.opened) {
      expect(calls).toHaveLength(1);
    } else {
      expect(typeof result.reason).toBe('string');
    }
  });

  it('never throws when spawn itself fails', () => {
    const throwing: SpawnFn = () => {
      throw new Error('nope');
    };
    const result = openFeatureReport({
      absPath: ABS,
      env: { DISPLAY: ':0' },
      spawnFn: throwing,
      platformValue: 'darwin',
    });
    expect(result.opened).toBe(false);
    expect(result.reason).toBe('nope');
  });
});
