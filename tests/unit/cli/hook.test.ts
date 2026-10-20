import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHookCommand,
  MANAGED_HOOK_NAMES,
  MANAGED_INSTALL_FIX,
  packagedHookScript,
  runPaqadHook,
} from '@/cli/commands/hook.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';

const REAL_LIB = resolve(process.cwd(), 'runtime/hooks/lib/paqad-disabled.mjs');

const dirs: string[] = [];
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fakeRuntime(script?: string): string {
  const root = tempDir('paqad-hook-runtime-');
  mkdirSync(join(root, 'hooks', 'lib'), { recursive: true });
  copyFileSync(REAL_LIB, join(root, 'hooks', 'lib', 'paqad-disabled.mjs'));
  if (script !== undefined) {
    writeFileSync(join(root, 'hooks', 'capability-gate.mjs'), script);
  }
  return root;
}

function paqadProject(): string {
  const root = tempDir('paqad-hook-project-');
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

const ECHO_SCRIPT = [
  "let input = '';",
  "process.stdin.on('data', (c) => { input += c; });",
  "process.stdin.on('end', () => {",
  "  process.stdout.write('out:' + input);",
  "  process.stderr.write('managed=' + (process.env.PAQAD_MANAGED ?? '') + ' argv=' + process.argv.slice(2).join(','));",
  '  process.exit(3);',
  '});',
].join('\n');

describe('paqad-ai hook', () => {
  it('refuses a name outside the allowlist with exit 2', async () => {
    const result = await runPaqadHook({ name: 'nope', args: [], managed: true, input: '{}' });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toBe('unknown paqad hook nope\n');
    expect(result.spawned).toBe(false);
  });

  it('exits 0 silently and spawns nothing when no .paqad/ is found walking up', async () => {
    const bare = tempDir('paqad-hook-bare-');
    const result = await runPaqadHook({
      name: 'capability-gate',
      args: ['pre-mutation'],
      managed: true,
      input: JSON.stringify({ cwd: bare }),
      runtimeRoot: fakeRuntime(ECHO_SCRIPT),
    });
    expect(result).toEqual({
      exitCode: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      spawned: false,
    });
  });

  it('holds the edit on a malformed payload', async () => {
    const result = await runPaqadHook({
      name: 'decision-pause-gate',
      args: [],
      managed: true,
      input: 'not json',
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain('unreadable hook payload');
  });

  it('holds the edit when the payload carries no cwd', async () => {
    const result = await runPaqadHook({
      name: 'decision-pause-gate',
      args: [],
      managed: true,
      input: JSON.stringify({ session_id: 's' }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain('no cwd');
  });

  it('holds the edit when the paqad runtime cannot be loaded', async () => {
    const result = await runPaqadHook({
      name: 'capability-gate',
      args: [],
      managed: true,
      input: JSON.stringify({ cwd: paqadProject() }),
      runtimeRoot: join(tempDir('paqad-hook-empty-'), 'runtime'),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain(MANAGED_INSTALL_FIX);
  });

  it('holds the edit when the packaged script is missing', async () => {
    const result = await runPaqadHook({
      name: 'capability-gate',
      args: ['pre-mutation'],
      managed: true,
      input: JSON.stringify({ cwd: paqadProject() }),
      runtimeRoot: fakeRuntime(),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain('missing from this paqad install');
    expect(result.stderr.toString()).toContain(MANAGED_INSTALL_FIX);
  });

  it('holds the edit and names the fix when the script times out', async () => {
    const result = await runPaqadHook({
      name: 'capability-gate',
      args: [],
      managed: true,
      input: JSON.stringify({ cwd: paqadProject() }),
      runtimeRoot: fakeRuntime('setTimeout(() => {}, 60000);'),
      timeoutMs: 300,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain('did not finish');
    expect(result.stderr.toString()).toContain(MANAGED_INSTALL_FIX);
  });

  it('passes stdin, stdout, stderr and the exit code through, and sets PAQAD_MANAGED', async () => {
    const project = paqadProject();
    const nested = join(project, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    const input = JSON.stringify({ cwd: nested });
    const result = await runPaqadHook({
      name: 'capability-gate',
      args: ['pre-mutation'],
      managed: true,
      input,
      env: { PATH: process.env.PATH },
      runtimeRoot: fakeRuntime(ECHO_SCRIPT),
    });
    expect(result.spawned).toBe(true);
    expect(result.exitCode).toBe(3);
    expect(result.stdout.toString()).toBe(`out:${input}`);
    expect(result.stderr.toString()).toBe('managed=1 argv=pre-mutation');
  });

  it('honours PAQAD_MANAGED from the environment without --managed', async () => {
    const result = await runPaqadHook({
      name: 'capability-gate',
      args: [],
      managed: false,
      input: JSON.stringify({ cwd: paqadProject() }),
      env: { PATH: process.env.PATH, PAQAD_MANAGED: '1' },
      runtimeRoot: fakeRuntime(ECHO_SCRIPT),
    });
    expect(result.stderr.toString()).toBe('managed=1 argv=');
  });

  it('leaves PAQAD_MANAGED unset when neither the flag nor the env asks for it', async () => {
    const result = await runPaqadHook({
      name: 'capability-gate',
      args: [],
      managed: false,
      input: JSON.stringify({ cwd: paqadProject() }),
      env: { PATH: process.env.PATH },
      runtimeRoot: fakeRuntime(ECHO_SCRIPT),
    });
    expect(result.stderr.toString()).toBe('managed= argv=');
  });

  it('resolves both allowlisted gates to real packaged scripts', () => {
    for (const name of MANAGED_HOOK_NAMES) {
      const script = packagedHookScript(name, getRuntimeRoot());
      expect(script).toBe(join(getRuntimeRoot(), 'hooks', `${name}.mjs`));
      expect(existsSync(script!)).toBe(true);
    }
    expect(packagedHookScript('agent-entry-gate', getRuntimeRoot())).toBeNull();
  });

  it('the command writes the gate result and sets the exit code', async () => {
    const bare = tempDir('paqad-hook-cmd-');
    const stdin = Readable.from([Buffer.from(JSON.stringify({ cwd: bare }))]);
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin);
    const before = process.exitCode;
    await createHookCommand().parseAsync(['node', 'hook', '--managed', 'decision-pause-gate'], {
      from: 'node',
    });
    expect(process.exitCode).toBe(0);
    process.exitCode = before;
  });

  it('the command reports an unknown hook on stderr with exit 2', async () => {
    let stderr = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    });
    const before = process.exitCode;
    await createHookCommand().parseAsync(['node', 'hook', 'nope'], { from: 'node' });
    expect(process.exitCode).toBe(2);
    expect(stderr).toBe('unknown paqad hook nope\n');
    process.exitCode = before;
  });
});
