import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { maybeStartOptionalEngineInstall } from '@/core/optional-package.js';

const SCRIPT = resolve('runtime/scripts/install-engine.mjs');
const WIN32 = process.platform === 'win32';
const { npmInvocation } = (await import(pathToFileURL(SCRIPT).href)) as {
  npmInvocation: (input: {
    platform: string;
    execPath: string;
    env: Record<string, string | undefined>;
    exists: (path: string) => boolean;
  }) => { command: string; args: string[] } | null;
};
const SPECS = ['@huggingface/transformers@4.3.1', 'openai@7.43.0'];
const FLAGS = ['--no-audit', '--no-fund', '--omit=dev', '--save-exact'];
const NPM_NOT_FOUND = 'npm was not found: no npm-cli.js beside node or on PATH.';
const COMMAND_LINE = `npm install ${SPECS.join(' ')} ${FLAGS.join(' ')}`;
const PROVIDER_KEYS = [
  'OPENAI_API_KEY',
  'COHERE_API_KEY',
  'CLAUDE_PLUGIN_OPTION_OPENAI_API_KEY',
  'CLAUDE_PLUGIN_OPTION_COHERE_API_KEY',
];

const RECORDER = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
appendFileSync(
  process.env.FAKE_RECORD,
  JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: { ...process.env } }) + '\\n',
);
process.exit(Number(process.env.FAKE_EXIT ?? 0));
`;

interface Recorded {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
}

let root: string;
let data: string;
let fakeBin: string;

const marker = () => join(data, '.paqad-engine-install.json');
const lock = () => join(data, '.paqad-engine-install.lock');
const log = () => join(data, '.paqad-engine-install.log');
const record = (name: string) => join(root, `${name}.jsonl`);

function recorded(name: string): Recorded[] {
  if (!existsSync(record(name))) return [];
  return readFileSync(record(name), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Recorded);
}

function readMarker(): { status: string; specs?: string[]; error?: string } {
  return JSON.parse(readFileSync(marker(), 'utf8')) as {
    status: string;
    specs?: string[];
    error?: string;
  };
}

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    const upper = name.toUpperCase();
    if (value === undefined || upper === 'PATH' || upper === 'NPM_EXECPATH') continue;
    if (PROVIDER_KEYS.includes(upper)) continue;
    env[name] = value;
  }
  return env;
}

function scriptEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...baseEnv(),
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
    npm_execpath: join(fakeBin, 'npm-cli.js'),
    PAQAD_ENGINE_SPECS: SPECS.join(' '),
    PAQAD_ENGINE_DIR: data,
    PAQAD_ENGINE_LOG: log(),
    PAQAD_ENGINE_MARKER: marker(),
    PAQAD_ENGINE_LOCK: lock(),
    FAKE_RECORD: record('npm'),
    ...extra,
  };
}

function runScript(
  env: Record<string, string>,
  cwd = root,
  script = SCRIPT,
  node = process.execPath,
) {
  return spawnSync(node, [script], { cwd, env, encoding: 'utf8' });
}

function nodeWithNoNpmBesideIt(): string {
  if (!WIN32) return process.execPath;
  const copy = join(root, 'node-alone', 'node.exe');
  mkdirSync(dirname(copy), { recursive: true });
  copyFileSync(process.execPath, copy);
  return copy;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'paqad-install-engine-')));
  data = join(root, 'plugin-data');
  fakeBin = join(root, 'bin');
  mkdirSync(data, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, 'npm'), RECORDER);
  chmodSync(join(fakeBin, 'npm'), 0o755);
  writeFileSync(join(fakeBin, 'npm-cli.js'), RECORDER);
  writeFileSync(lock(), '1');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('runtime/scripts/install-engine.mjs', () => {
  it('AC-15: runs npm with the pinned specs and flags in plugin data, and logs the exact command', () => {
    const run = runScript(scriptEnv());
    expect(run.status, run.stderr).toBe(0);
    const [npm] = recorded('npm');
    expect(npm!.argv).toEqual(['install', ...SPECS, ...FLAGS]);
    expect(npm!.argv).not.toContain('--ignore-scripts');
    expect(realpathSync(npm!.cwd)).toBe(realpathSync(data));
    expect(readFileSync(log(), 'utf8')).toContain(`${COMMAND_LINE}\n`);
  });

  it('AC-16: a success leaves a ready marker with the specs, no lock, and reads as already present', () => {
    runScript(scriptEnv());
    expect(readMarker()).toMatchObject({ status: 'ready', specs: SPECS });
    expect(existsSync(lock())).toBe(false);
    const pkgRoot = join(root, 'package-root');
    mkdirSync(join(pkgRoot, 'runtime'), { recursive: true });
    writeFileSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        paqadEngines: { '@huggingface/transformers': '4.3.1', openai: '7.43.0' },
      }),
    );
    const start = vi.fn();
    const outcome = maybeStartOptionalEngineInstall(
      { CLAUDE_PLUGIN_DATA: data, PAQAD_FRAMEWORK_HOME: join(pkgRoot, 'runtime') },
      {
        resolve: () => join(data, 'node_modules', '@huggingface', 'transformers', 'index.js'),
        startInstall: start,
      },
    );
    expect(outcome).toBe('already-present');
    expect(start).not.toHaveBeenCalled();
  });

  it('AC-17: the npm child gets no provider key, in any casing, and the rebuild child keeps them all', () => {
    const cli = join(root, 'cli.cjs');
    writeFileSync(cli, RECORDER);
    const project = join(root, 'project');
    mkdirSync(project);
    const keys = {
      openai_api_key: 'one',
      COHERE_API_KEY: 'two',
      CLAUDE_PLUGIN_OPTION_OPENAI_API_KEY: 'three',
      CLAUDE_PLUGIN_OPTION_COHERE_API_KEY: 'four',
    };
    const env = scriptEnv({
      ...keys,
      PAQAD_ENGINE_CLI: cli,
      PAQAD_ENGINE_REBUILD_ROOT: project,
    });
    const run = runScript(env);
    expect(run.status, run.stderr).toBe(0);
    const [npmRun, rebuildRun] = recorded('npm');
    const upperKeys = (found: Recorded) => Object.keys(found.env).map((key) => key.toUpperCase());
    for (const key of PROVIDER_KEYS) {
      expect(upperKeys(npmRun!), key).not.toContain(key);
      expect(upperKeys(rebuildRun!), key).toContain(key);
    }
    expect(rebuildRun!.argv).toEqual(['rag', 'rebuild', '--project-root', project]);
    expect(realpathSync(rebuildRun!.cwd)).toBe(realpathSync(project));
  });

  it('AC-17: a failed rebuild lands in the log and leaves the install ready', () => {
    const cli = join(root, 'cli.cjs');
    writeFileSync(cli, 'process.exit(3);\n');
    const project = join(root, 'project');
    mkdirSync(project);
    runScript(scriptEnv({ PAQAD_ENGINE_CLI: cli, PAQAD_ENGINE_REBUILD_ROOT: project }));
    expect(readMarker().status).toBe('ready');
    expect(readFileSync(log(), 'utf8')).toContain('rag rebuild failed:');
    expect(existsSync(lock())).toBe(false);
  });

  it('AC-18: a failing npm writes a failed marker with one line, logs it, starts no rebuild and drops the lock', () => {
    const cli = join(root, 'cli.cjs');
    writeFileSync(cli, RECORDER);
    const project = join(root, 'project');
    mkdirSync(project);
    runScript(
      scriptEnv({ FAKE_EXIT: '7', PAQAD_ENGINE_CLI: cli, PAQAD_ENGINE_REBUILD_ROOT: project }),
    );
    const failed = readMarker();
    expect(failed.status).toBe('failed');
    expect(failed.error).toBeTruthy();
    expect(failed.error).not.toContain('\n');
    expect(readFileSync(log(), 'utf8')).toContain(failed.error!);
    expect(recorded('npm')).toHaveLength(1);
    expect(existsSync(lock())).toBe(false);
  });

  it('AC-19: when no npm can be started the same first line reaches the log and the marker', () => {
    const empty = join(root, 'empty');
    mkdirSync(empty);
    const env = scriptEnv({ PATH: empty });
    delete env.npm_execpath;
    runScript(env, root, SCRIPT, nodeWithNoNpmBesideIt());
    const failed = readMarker();
    expect(failed.status).toBe('failed');
    if (WIN32) expect(failed.error).toBe(NPM_NOT_FOUND);
    expect(failed.error).toBeTruthy();
    expect(failed.error).not.toContain('\n');
    expect(readFileSync(log(), 'utf8')).toContain(`${failed.error!}\n`);
    expect(existsSync(lock())).toBe(false);
  });

  it('AC-19: when the log cannot be opened the marker is still failed and the lock gone', () => {
    const notAFile = join(root, 'log-is-a-folder');
    mkdirSync(notAFile);
    runScript(scriptEnv({ PAQAD_ENGINE_LOG: notAFile }));
    expect(readMarker().status).toBe('failed');
    expect(existsSync(lock())).toBe(false);
    expect(recorded('npm')).toEqual([]);
  });

  it('AC-20: a session started in a project with its own .npmrc still installs into plugin data', () => {
    const project = join(root, 'project');
    mkdirSync(project);
    writeFileSync(join(project, '.npmrc'), 'registry=https://example.invalid/\n');
    runScript(scriptEnv(), project);
    expect(realpathSync(recorded('npm')[0]!.cwd)).toBe(realpathSync(data));
  });

  it('AC-28: importing the script starts no install and leaves the marker alone', () => {
    writeFileSync(marker(), '{"status":"installing"}');
    const run = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});`],
      { cwd: root, env: scriptEnv(), encoding: 'utf8' },
    );
    expect(run.status, run.stderr).toBe(0);
    expect(recorded('npm')).toEqual([]);
    expect(readFileSync(marker(), 'utf8')).toBe('{"status":"installing"}');
    expect(existsSync(lock())).toBe(true);
  });

  it('AC-28: started through a linked folder, as the stable copy is, it installs and drops the lock', () => {
    const link = join(root, 'linked');
    symlinkSync(dirname(SCRIPT), link, 'junction');
    const run = runScript(scriptEnv(), root, join(link, 'install-engine.mjs'));
    expect(run.status, run.stderr).toBe(0);
    expect(recorded('npm')).toHaveLength(1);
    expect(existsSync(lock())).toBe(false);
  });

  it('imports only node built-ins and starts npm with no shell', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const name of imports) expect(name.startsWith('node:'), name).toBe(true);
    expect(source).not.toMatch(/shell\s*:/);
    expect(source).not.toContain('secrets.env');
  });
});

describe('npmInvocation', () => {
  const NODE = 'C:\\Program Files\\nodejs\\node.exe';
  const BESIDE_NODE = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  const DECLARED = 'D:\\tools\\npm\\bin\\npm-cli.js';
  const ON_PATH = 'E:\\node\\node_modules\\npm\\bin\\npm-cli.js';

  const resolveOn = (env: Record<string, string>, files: string[], platform = 'win32') =>
    npmInvocation({
      platform,
      execPath: NODE,
      env,
      exists: (path) => files.includes(path),
    });

  it('AC-26: uses a valid npm_execpath through node', () => {
    expect(resolveOn({ npm_execpath: DECLARED }, [DECLARED, BESIDE_NODE])).toEqual({
      command: NODE,
      args: [DECLARED],
    });
  });

  it.each([
    ['a pnpm.cjs', 'D:\\tools\\pnpm\\bin\\pnpm.cjs'],
    ['a relative path', 'tools\\npm-cli.js'],
    ['a file that is not there', 'D:\\gone\\npm-cli.js'],
  ])('AC-26: refuses %s npm_execpath and moves on to the file beside node', (_label, value) => {
    const present = value.includes('gone') ? [] : [value];
    expect(resolveOn({ npm_execpath: value }, [...present, BESIDE_NODE])).toEqual({
      command: NODE,
      args: [BESIDE_NODE],
    });
    expect(resolveOn({ npm_execpath: value }, present)).toBeNull();
  });

  it('AC-26: finds the file beside node', () => {
    expect(resolveOn({}, [BESIDE_NODE])).toEqual({ command: NODE, args: [BESIDE_NODE] });
  });

  it.each(['Path', 'PATH', 'path'])(
    'AC-26: reads the %s variable for an entry holding npm.cmd',
    (name) => {
      expect(resolveOn({ [name]: 'C:\\other;E:\\node' }, ['E:\\node\\npm.cmd', ON_PATH])).toEqual({
        command: NODE,
        args: [ON_PATH],
      });
    },
  );

  it('AC-26: skips empty and relative entries', () => {
    const files = [
      'bin\\npm.cmd',
      'bin\\node_modules\\npm\\bin\\npm-cli.js',
      'E:\\node\\npm.cmd',
      ON_PATH,
    ];
    expect(resolveOn({ Path: ';bin;.;E:\\node' }, files)).toEqual({
      command: NODE,
      args: [ON_PATH],
    });
  });

  it('AC-26: returns null when nothing is found', () => {
    expect(resolveOn({}, [])).toBeNull();
    expect(resolveOn({ Path: ';bin' }, ['bin\\npm.cmd'])).toBeNull();
    expect(resolveOn({ Path: 'E:\\node' }, ['E:\\node\\npm.cmd'])).toBeNull();
  });

  it.each(['linux', 'darwin'])('AC-26: on %s it is npm with no extra arguments', (platform) => {
    expect(resolveOn({ npm_execpath: DECLARED }, [DECLARED], platform)).toEqual({
      command: 'npm',
      args: [],
    });
  });

  it.runIf(WIN32)(
    'AC-27: the real node install starts npm-cli.js with no shell and no EINVAL',
    () => {
      const npm = npmInvocation({
        platform: process.platform,
        execPath: process.execPath,
        env: process.env,
        exists: existsSync,
      });
      expect(npm).not.toBeNull();
      expect(existsSync(npm!.args[0]!)).toBe(true);
      const version = spawnSync(npm!.command, [...npm!.args, '--version'], { encoding: 'utf8' });
      expect(version.error).toBeUndefined();
      expect(version.status, version.stderr).toBe(0);
    },
    60_000,
  );
});
