import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Command } from 'commander';

import { PAQAD_LIVE_HOOKS } from '@/adapters/shared/paqad-hooks.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';

export const MANAGED_HOOK_NAMES: readonly string[] = ['capability-gate', 'decision-pause-gate'];

export const MANAGED_INSTALL_FIX =
  'paqad-ai must be installed globally on this machine; ask IT to install it.';

const DEFAULT_TIMEOUT_MS = 25_000;
const BLOCK_EXIT = 2;

export interface PaqadHookRequest {
  name: string;
  args: string[];
  managed: boolean;
  input: string;
  env?: NodeJS.ProcessEnv;
  runtimeRoot?: string;
  timeoutMs?: number;
}

export interface PaqadHookResult {
  exitCode: number;
  stdout: Buffer;
  stderr: Buffer;
  spawned: boolean;
}

interface RuntimeHookLib {
  findProjectRootFromCwd: (startDir: string) => string | undefined;
  parseHookPayload: (input: string) => Record<string, unknown> | undefined;
}

function failure(message: string): PaqadHookResult {
  return {
    exitCode: BLOCK_EXIT,
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(`${message}\n`),
    spawned: false,
  };
}

export function packagedHookScript(name: string, runtimeRoot: string): string | null {
  if (!MANAGED_HOOK_NAMES.includes(name)) return null;
  const spec = PAQAD_LIVE_HOOKS.find((entry) => entry.hookFile === `${name}.mjs`);
  return spec ? join(runtimeRoot, 'hooks', spec.hookFile) : null;
}

async function loadRuntimeHookLib(runtimeRoot: string): Promise<RuntimeHookLib> {
  const libPath = join(runtimeRoot, 'hooks', 'lib', 'paqad-disabled.mjs');
  return (await import(pathToFileURL(libPath).href)) as RuntimeHookLib;
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function runPaqadHook(request: PaqadHookRequest): Promise<PaqadHookResult> {
  const { name, args, input } = request;
  const env = request.env ?? process.env;
  if (!MANAGED_HOOK_NAMES.includes(name)) {
    return failure(`unknown paqad hook ${name}`);
  }
  let runtimeRoot: string;
  let lib: RuntimeHookLib;
  try {
    runtimeRoot = request.runtimeRoot ?? getRuntimeRoot();
    lib = await loadRuntimeHookLib(runtimeRoot);
  } catch (error) {
    return failure(
      `[paqad] hook ${name} could not load the paqad runtime (${errorText(error)}). ${MANAGED_INSTALL_FIX}`,
    );
  }
  const payload = lib.parseHookPayload(input);
  if (!payload) {
    return failure(
      `[paqad] hook ${name} received an unreadable hook payload, so the edit is held.`,
    );
  }
  const cwd = typeof payload.cwd === 'string' ? payload.cwd.trim() : '';
  if (cwd === '') {
    return failure(
      `[paqad] hook ${name} received a hook payload with no cwd, so the edit is held.`,
    );
  }
  if (lib.findProjectRootFromCwd(cwd) === undefined) {
    return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), spawned: false };
  }
  const script = packagedHookScript(name, runtimeRoot);
  if (!script || !existsSync(script)) {
    return failure(
      `[paqad] hook ${name} is missing from this paqad install. ${MANAGED_INSTALL_FIX}`,
    );
  }
  const childEnv: NodeJS.ProcessEnv = request.managed ? { ...env, PAQAD_MANAGED: '1' } : { ...env };
  const result = spawnSync(process.execPath, [script, ...args], {
    input,
    env: childEnv,
    timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status === null) {
    const kind = result.error ? errorText(result.error) : `signal ${String(result.signal)}`;
    return failure(`[paqad] hook ${name} did not finish (${kind}). ${MANAGED_INSTALL_FIX}`);
  }
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr, spawned: true };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createHookCommand(): Command {
  return new Command('hook')
    .description(
      'Run a packaged paqad edit gate (capability-gate, decision-pause-gate) for managed settings',
    )
    .argument('<name>', `one of: ${MANAGED_HOOK_NAMES.join(', ')}`)
    .argument('[args...]', 'arguments passed to the hook script')
    .option('--managed', 'run as an organization-managed gate (sets PAQAD_MANAGED=1)')
    .action(async (name: string, args: string[], options: { managed?: boolean }) => {
      const input = MANAGED_HOOK_NAMES.includes(name) ? await readStdin() : '';
      const result = await runPaqadHook({ name, args, managed: options.managed === true, input });
      if (result.stdout.length > 0) process.stdout.write(result.stdout);
      if (result.stderr.length > 0) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    });
}
