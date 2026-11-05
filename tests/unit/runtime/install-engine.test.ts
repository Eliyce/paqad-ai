import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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
const SPECS = ['@huggingface/transformers@4.3.1', 'openai@7.43.0'];
const FLAGS = ['--no-audit', '--no-fund', '--omit=dev', '--save-exact'];
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
    PAQAD_ENGINE_SPECS: SPECS.join(' '),
    PAQAD_ENGINE_DIR: data,
    PAQAD_ENGINE_LOG: log(),
    PAQAD_ENGINE_MARKER: marker(),
    PAQAD_ENGINE_LOCK: lock(),
    FAKE_RECORD: record('npm'),
    ...extra,
  };
}

function runScript(env: Record<string, string>, cwd = root, script = SCRIPT) {
  return spawnSync(process.execPath, [script], { cwd, env, encoding: 'utf8' });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'paqad-install-engine-')));
  data = join(root, 'plugin-data');
  fakeBin = join(root, 'bin');
  mkdirSync(data, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, 'npm'), RECORDER);
  chmodSync(join(fakeBin, 'npm'), 0o755);
  writeFileSync(lock(), '1');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('runtime/scripts/install-engine.mjs', () => {
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
    runScript(scriptEnv({ PATH: empty }));
    const failed = readMarker();
    expect(failed.status).toBe('failed');
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
