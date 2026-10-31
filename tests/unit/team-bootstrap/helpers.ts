import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const LAUNCHER = resolve(__dirname, '../../../runtime/templates/team-bootstrap/hook.mjs');

export interface LauncherModule {
  runLauncher: (argv: string[], env: NodeJS.ProcessEnv, deps?: Partial<FakeDeps>) => number;
  [key: string]: unknown;
}

export interface SpawnCall {
  command: string;
  args: string[];
  options: { input?: Buffer; env?: NodeJS.ProcessEnv };
}

export interface FakeDeps {
  home: () => string;
  now: () => number;
  pid: number;
  nodeMajor: number;
  sleep: (ms: number) => void;
  pidAlive: (pid: number) => boolean;
  spawnSync: (command: string, args: string[], options: SpawnCall['options']) => unknown;
  spawnDetached: (command: string, args: string[], options: unknown) => void;
  runGit: (args: string[], options: { timeout: number }) => unknown;
  readStdin: () => Buffer;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  launcherPath: string;
  projectRoot: string;
}

export const COPY_SCRIPTS = [
  'plugin-session-start.mjs',
  'agent-entry-session-start.mjs',
  'agent-entry-gate.mjs',
  'decision-pause-gate.mjs',
  'capability-gate.mjs',
  'stage-writer.mjs',
  'agent-entry-prompt-gate.mjs',
  'verification-completion.mjs',
];

export interface Sandbox {
  home: string;
  project: string;
  cleanup: () => void;
}

export function makeSandbox(): Sandbox {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'paqad-team-home-')));
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'paqad-team-project-')));
  mkdirSync(join(project, '.paqad'), { recursive: true });
  writeFileSync(join(project, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current\n');
  return {
    home,
    project,
    cleanup: () => {
      rmSync(home, { recursive: true, force: true });
      rmSync(project, { recursive: true, force: true });
    },
  };
}

export function writeCopy(root: string, scripts: readonly string[] = COPY_SCRIPTS): void {
  const hooks = join(root, 'runtime', 'hooks');
  mkdirSync(hooks, { recursive: true });
  for (const name of scripts) {
    writeFileSync(join(hooks, name), RECORDING_HOOK);
  }
}

export const RECORDING_HOOK = [
  "import { appendFileSync, readFileSync } from 'node:fs';",
  "const input = readFileSync(0, 'utf8');",
  'const log = process.env.FAKE_HOOK_LOG;',
  'if (log) {',
  '  appendFileSync(log, JSON.stringify({',
  '    script: process.argv[1].split(/[\\\\/]/).pop(),',
  '    args: process.argv.slice(2),',
  '    input,',
  '    pluginRoot: process.env.CLAUDE_PLUGIN_ROOT ?? null,',
  '    pluginData: process.env.CLAUDE_PLUGIN_DATA ?? null,',
  '    rag: process.env.PAQAD_RAG_ENABLED ?? null,',
  "  }) + '\\n');",
  '}',
  "process.exit(Number(process.env.FAKE_HOOK_EXIT ?? '0'));",
  '',
].join('\n');

export interface Captured {
  stdout: string[];
  stderr: string[];
  spawns: SpawnCall[];
  detached: SpawnCall[];
  gitCalls: string[][];
}

export function fakeDeps(
  sandbox: Sandbox,
  overrides: Partial<FakeDeps> = {},
): { deps: Partial<FakeDeps>; captured: Captured } {
  const captured: Captured = { stdout: [], stderr: [], spawns: [], detached: [], gitCalls: [] };
  const deps: Partial<FakeDeps> = {
    home: () => sandbox.home,
    now: () => 1_000_000_000_000,
    pid: 4242,
    nodeMajor: 22,
    sleep: () => undefined,
    pidAlive: () => false,
    spawnSync: (command, args, options) => {
      captured.spawns.push({ command, args, options });
      return { status: 0 };
    },
    spawnDetached: (command, args, options) => {
      captured.detached.push({ command, args, options: options as SpawnCall['options'] });
    },
    runGit: (args) => {
      captured.gitCalls.push(args);
      return { status: 1 };
    },
    readStdin: () => Buffer.from('{}'),
    stdout: (text) => {
      captured.stdout.push(text);
    },
    stderr: (text) => {
      captured.stderr.push(text);
    },
    launcherPath: LAUNCHER,
    projectRoot: sandbox.project,
    ...overrides,
  };
  return { deps, captured };
}

export function payload(event: string, sessionId = 'ses-team', extra: object = {}): Buffer {
  return Buffer.from(JSON.stringify({ session_id: sessionId, hook_event_name: event, ...extra }));
}

export async function loadLauncher(): Promise<LauncherModule> {
  return (await import(LAUNCHER)) as LauncherModule;
}

export function cloneSucceeds(sandbox: Sandbox, scripts: readonly string[] = COPY_SCRIPTS) {
  return (args: string[]): { status: number } => {
    const target = args[args.length - 1]!;
    writeCopy(target, scripts);
    return { status: 0 };
  };
}

export const HOME_PATH_PATTERN = /\/Users\/[^/\s"']+|\/home\/[^/\s"']+|C:\\\\?Users\\\\?[^\\\s"']+/;
