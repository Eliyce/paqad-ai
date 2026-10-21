import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { getPackageRoot } from '@/core/runtime-paths.js';
import { frameworkLinkHome } from '@/health/plugin-install.js';

function alternateBases(env: NodeJS.ProcessEnv): string[] {
  const bases: string[] = [];

  const pluginData = env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    bases.push(join(pluginData, 'package.json'));
  }

  try {
    const runtimeReal = realpathSync(frameworkLinkHome(env));
    bases.push(join(dirname(runtimeReal), 'package.json'));
  } catch {}

  /* v8 ignore start -- npm is present in this repo's env so npmGlobalRoot is non-null here; the absent-npm branch guards other hosts. */
  const globalRoot = npmGlobalRoot();
  if (globalRoot) {
    bases.push(join(globalRoot, 'paqad-ai', 'package.json'));
    /* v8 ignore stop */
  }

  return bases;
}

function npmGlobalRoot(): string | null {
  try {
    const out = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    /* v8 ignore next -- npm always prints a path in this repo's env; the empty-output guard is defensive. */
    return out.length > 0 ? out : null;
    /* v8 ignore start -- npm is present in this repo's test env; this guards hosts without npm on PATH. */
  } catch {
    return null;
  }
  /* v8 ignore stop */
}

export function resolveOptionalPackage(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  for (const base of [import.meta.url, ...alternateBases(env)]) {
    try {
      return createRequire(base).resolve(name);
    } catch {}
  }
  return null;
}

export async function loadOptionalPackage<T = unknown>(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  try {
    return (await import(name)) as T;
  } catch {}
  for (const base of alternateBases(env)) {
    let loaded: T;
    try {
      loaded = createRequire(base)(name) as T;
    } catch {
      continue;
    }
    kickOffEngineInstall(env);
    return loaded;
  }
  kickOffEngineInstall(env);
  throw new Error(`optional package ${name} is not installed`);
}

function kickOffEngineInstall(env: NodeJS.ProcessEnv): void {
  /* v8 ignore start -- best-effort kick-off; its internals already fail safe, so this catch rarely fires. */
  try {
    maybeStartOptionalEngineInstall(env);
  } catch {}
  /* v8 ignore stop */
}

const OPTIONAL_ENGINES = ['@huggingface/transformers', 'openai'] as const;

const PRIMARY_ENGINE = '@huggingface/transformers';

const INSTALL_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const ENGINE_INSTALL_NETWORK_HINT =
  'If this machine is offline or behind a proxy, install the engine manually: run ' +
  '`npm install @huggingface/transformers` inside the CLAUDE_PLUGIN_DATA directory.';

interface EnginePaths {
  readonly marker: string;
  readonly lock: string;
  readonly log: string;
}

function enginePaths(pluginData: string): EnginePaths {
  return {
    marker: join(pluginData, '.paqad-engine-install.json'),
    lock: join(pluginData, '.paqad-engine-install.lock'),
    log: join(pluginData, '.paqad-engine-install.log'),
  };
}

interface InstallMarker {
  status: 'installing' | 'ready' | 'failed';
  attempted_at: string;
  specs?: string[];
  error?: string;
}

function readInstallMarker(markerPath: string): InstallMarker | null {
  try {
    return JSON.parse(readFileSync(markerPath, 'utf8')) as InstallMarker;
  } catch {
    return null;
  }
}

function readEngineSpecs(env: NodeJS.ProcessEnv): string[] {
  try {
    const pkgRoot = dirname(realpathSync(frameworkLinkHome(env)));
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    const specs: string[] = [];
    for (const name of OPTIONAL_ENGINES) {
      const range = deps[name];
      if (typeof range === 'string' && range.length > 0) {
        specs.push(`${name}@${range}`);
      }
    }
    return specs;
  } catch {
    return [];
  }
}

export type EngineInstallOutcome =
  | 'started'
  | 'already-present'
  | 'in-progress'
  | 'throttled'
  | 'no-plugin-data'
  | 'no-pinned-range';

export interface EngineInstallDeps {
  now?: () => number;
  resolve?: (name: string, env: NodeJS.ProcessEnv) => string | null;
  readSpecs?: (env: NodeJS.ProcessEnv) => string[];
  startInstall?: (specs: string[], dir: string, paths: EnginePaths, projectRoot?: string) => void;
}

function isWithin(dir: string, file: string): boolean {
  const rel = relative(dir, file);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

function resolvesFromPluginData(resolved: string, pluginData: string): boolean {
  if (isWithin(pluginData, resolved)) {
    return true;
  }
  try {
    return isWithin(realpathSync(pluginData), resolved);
  } catch {
    return false;
  }
}

function installedSpecsMatch(marker: InstallMarker | null, declared: string[]): boolean {
  const installed = marker?.status === 'ready' ? marker.specs : undefined;
  return (
    Array.isArray(installed) && [...installed].sort().join(' ') === [...declared].sort().join(' ')
  );
}

export interface EngineInstallOptions {
  projectRoot?: string;
}

export function maybeStartOptionalEngineInstall(
  env: NodeJS.ProcessEnv = process.env,
  deps: EngineInstallDeps = {},
  options: EngineInstallOptions = {},
): EngineInstallOutcome {
  const pluginData = env.CLAUDE_PLUGIN_DATA;
  if (!pluginData) {
    return 'no-plugin-data';
  }
  const resolve = deps.resolve ?? resolveOptionalPackage;
  const resolved = resolve(PRIMARY_ENGINE, env);
  if (resolved !== null && !resolvesFromPluginData(resolved, pluginData)) {
    return 'already-present';
  }
  const paths = enginePaths(pluginData);
  const marker = readInstallMarker(paths.marker);
  const specs = (deps.readSpecs ?? readEngineSpecs)(env);
  if (resolved !== null && (specs.length === 0 || installedSpecsMatch(marker, specs))) {
    return 'already-present';
  }
  if (marker?.status === 'installing' && existsSync(paths.lock)) {
    return 'in-progress';
  }
  const now = deps.now ?? Date.now;
  if (marker && now() - Date.parse(marker.attempted_at) < INSTALL_RETRY_INTERVAL_MS) {
    return 'throttled';
  }
  if (specs.length === 0) {
    return 'no-pinned-range';
  }
  mkdirSync(pluginData, { recursive: true });
  writeFileSync(
    join(pluginData, 'package.json'),
    `${JSON.stringify({ private: true }, null, 2)}\n`,
  );
  writeFileSync(paths.lock, String(process.pid));
  writeFileSync(
    paths.marker,
    JSON.stringify({ status: 'installing', attempted_at: new Date(now()).toISOString(), specs }),
  );
  /* v8 ignore next -- the real spawn default is exercised under manual-scenario sign-off, not units. */
  (deps.startInstall ?? spawnEngineInstall)(specs, pluginData, paths, options.projectRoot);
  return 'started';
}

/* v8 ignore start -- spawns a real detached `npm install`; the decision logic around it is unit
   tested through the injected startInstall seam, and the install itself is covered by manual
   scenario sign-off (the pentest-engine / visual-evidence provisioning precedent). */
function spawnEngineInstall(
  specs: string[],
  dir: string,
  paths: EnginePaths,
  projectRoot?: string,
): void {
  const installer = `
    const { execFileSync } = require('node:child_process');
    const { openSync, writeFileSync, rmSync } = require('node:fs');
    const specs = process.env.PAQAD_ENGINE_SPECS.split(' ');
    try {
      const fd = openSync(process.env.PAQAD_ENGINE_LOG, 'a');
      execFileSync('npm', ['install', ...specs, '--no-audit', '--no-fund', '--omit=dev'], {
        cwd: process.env.PAQAD_ENGINE_DIR, stdio: ['ignore', fd, fd],
      });
      writeFileSync(process.env.PAQAD_ENGINE_MARKER, JSON.stringify({ status: 'ready', attempted_at: new Date().toISOString(), specs }));
      if (process.env.PAQAD_ENGINE_REBUILD_ROOT && process.env.PAQAD_ENGINE_CLI) {
        try {
          execFileSync(process.execPath, [process.env.PAQAD_ENGINE_CLI, 'rag', 'rebuild', '--project-root', process.env.PAQAD_ENGINE_REBUILD_ROOT], {
            cwd: process.env.PAQAD_ENGINE_REBUILD_ROOT, stdio: ['ignore', fd, fd],
          });
        } catch {}
      }
    } catch (e) {
      const msg = String(e && e.message ? e.message : e).split('\\n')[0];
      writeFileSync(process.env.PAQAD_ENGINE_MARKER, JSON.stringify({ status: 'failed', attempted_at: new Date().toISOString(), error: msg }));
    } finally {
      try { rmSync(process.env.PAQAD_ENGINE_LOCK); } catch {}
    }
  `;
  const child = spawn(process.execPath, ['-e', installer], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      PAQAD_ENGINE_SPECS: specs.join(' '),
      PAQAD_ENGINE_DIR: dir,
      PAQAD_ENGINE_LOG: paths.log,
      PAQAD_ENGINE_MARKER: paths.marker,
      PAQAD_ENGINE_LOCK: paths.lock,
      ...(projectRoot
        ? {
            PAQAD_ENGINE_REBUILD_ROOT: projectRoot,
            PAQAD_ENGINE_CLI: join(getPackageRoot(), 'dist', 'cli', 'index.js'),
          }
        : {}),
    },
  });
  child.unref();
}
/* v8 ignore stop */

export type OptionalEngineState = 'ready' | 'installing' | 'install failed' | 'not installed';

export interface OptionalEngineReport {
  state: OptionalEngineState;
  detail?: string;
  hint?: string;
}

export interface OptionalEngineReportDeps {
  resolve?: (name: string, env: NodeJS.ProcessEnv) => string | null;
}

export function describeOptionalEngine(
  env: NodeJS.ProcessEnv = process.env,
  deps: OptionalEngineReportDeps = {},
): OptionalEngineReport {
  const resolve = deps.resolve ?? resolveOptionalPackage;
  if (resolve(PRIMARY_ENGINE, env) !== null) {
    return { state: 'ready' };
  }
  const pluginData = env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    const marker = readInstallMarker(enginePaths(pluginData).marker);
    if (marker?.status === 'installing') {
      return { state: 'installing' };
    }
    if (marker?.status === 'failed') {
      return {
        state: 'install failed',
        detail: (marker.error ?? '').split('\n')[0],
        hint: ENGINE_INSTALL_NETWORK_HINT,
      };
    }
  }
  return { state: 'not installed' };
}
