import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the dashboard server and the browser opener so the command logic can be
// exercised without binding a port or launching a browser.
const { startDashboardServer, closeMock, openBrowser } = vi.hoisted(() => {
  const closeMock = vi.fn(async () => undefined);
  return {
    closeMock,
    startDashboardServer: vi.fn(async () => ({ url: 'http://127.0.0.1:5372', close: closeMock })),
    openBrowser: vi.fn(() => ({ opened: true })),
  };
});
vi.mock('@/dashboard/server.js', () => ({ startDashboardServer }));
vi.mock('@/graph/opener.js', () => ({ openBrowser }));

import { createDashboardCommand } from '@/cli/commands/dashboard';
import { createGraphCommand } from '@/cli/commands/graph';

const ENABLED_PROFILE =
  'project:\n  name: demo\nactive_capabilities:\n  - content\npaqad:\n  enabled: true\n';
const DISABLED_PROFILE =
  'project:\n  name: demo\nactive_capabilities:\n  - content\npaqad:\n  enabled: false\n';

const COMMANDS = [
  { name: 'dashboard', create: createDashboardCommand, urlFragment: '#/dashboard' },
  { name: 'graph', create: createGraphCommand, urlFragment: '#/graph' },
] as const;

describe.each(COMMANDS)('paqad-ai $name command', ({ create, urlFragment }) => {
  let root: string;
  let out: string[];
  let err: string[];
  let signalHandlers: Record<string, () => void>;
  let spies: Array<ReturnType<typeof vi.spyOn>>;

  function run(args: string[] = []): Promise<unknown> {
    return create().parseAsync(['--project-root', root, '--no-open', ...args], { from: 'user' });
  }

  function onboard(profile = ENABLED_PROFILE): void {
    writeFileSync(join(root, '.paqad', 'onboarding-manifest.json'), '{}');
    writeFileSync(join(root, '.paqad', 'project-profile.yaml'), profile);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-graph-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    out = [];
    err = [];
    signalHandlers = {};
    spies = [
      vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => {
        out.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
        return true;
      }),
      vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => {
        err.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
        return true;
      }),
      vi.spyOn(process, 'on').mockImplementation((event: string, handler: () => void) => {
        signalHandlers[event] = handler;
        return process;
      }),
      vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never),
    ];
    process.exitCode = undefined;
    startDashboardServer.mockClear();
    openBrowser.mockClear();
    openBrowser.mockReturnValue({ opened: true });
    closeMock.mockClear();
    closeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    rmSync(root, { recursive: true, force: true });
    process.exitCode = undefined;
    delete process.env.PAQAD_DISABLED;
  });

  it('errors (exit 2) when the project is not onboarded', async () => {
    rmSync(join(root, '.paqad'), { recursive: true, force: true });
    await run();
    expect(process.exitCode).toBe(2);
    expect(err.join('')).toMatch(/no \.paqad\/ directory/);
    expect(startDashboardServer).not.toHaveBeenCalled();
  });

  it('errors (exit 2) when the onboarding manifest is missing', async () => {
    writeFileSync(join(root, '.paqad', 'project-profile.yaml'), ENABLED_PROFILE);
    await run();
    expect(process.exitCode).toBe(2);
    expect(err.join('')).toMatch(/onboarding manifest missing/);
  });

  it('does not start the server when disabled via the profile flag', async () => {
    onboard(DISABLED_PROFILE);
    await run();
    expect(startDashboardServer).not.toHaveBeenCalled();
    expect(out.join('')).toContain('disabled (vanilla mode)');
    expect(process.exitCode).not.toBe(2);
  });

  it('does not start the server when disabled via PAQAD_DISABLED', async () => {
    onboard(ENABLED_PROFILE);
    process.env.PAQAD_DISABLED = '1';
    await run();
    expect(startDashboardServer).not.toHaveBeenCalled();
    expect(out.join('')).toContain('disabled (vanilla mode)');
  });

  it('errors (exit 2) on an invalid --port', async () => {
    onboard();
    await run(['--port', 'banana']);
    expect(process.exitCode).toBe(2);
    expect(err.join('')).toMatch(/invalid --port/);
    expect(startDashboardServer).not.toHaveBeenCalled();
  });

  it('starts the server and prints the listening URL when enabled', async () => {
    onboard();
    await run();
    expect(startDashboardServer).toHaveBeenCalledTimes(1);
    expect(out.join('')).toContain('listening at');
    expect(out.join('')).toContain(urlFragment);
  });

  it('prints only the URL in --quiet mode', async () => {
    onboard();
    await run(['--quiet']);
    expect(out.join('')).not.toContain('listening at');
    expect(out.join('')).toContain(urlFragment);
  });

  it('reports when the browser could not be opened', async () => {
    onboard();
    openBrowser.mockReturnValue({ opened: false, reason: 'no DISPLAY' });
    await run();
    expect(out.join('')).toContain('browser not opened: no DISPLAY');
  });

  it('shuts down cleanly on SIGINT', async () => {
    onboard();
    await run();
    expect(signalHandlers.SIGINT).toBeDefined();
    signalHandlers.SIGINT!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it('sets exit code 1 when shutdown fails', async () => {
    onboard();
    closeMock.mockRejectedValueOnce(new Error('boom'));
    await run();
    signalHandlers.SIGTERM!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(err.join('')).toMatch(/error during shutdown: boom/);
    expect(process.exitCode).toBe(1);
  });
});
