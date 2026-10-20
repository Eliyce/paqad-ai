import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { setEngineLogger } from '@/core/logger-registry.js';
import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { ensureSchemaMarkerSync } from '@/core/schema-version.js';
import type { EngineLogger } from '@/core/types/logger.js';
import { VERSION } from '@/index.js';
import {
  resolveFrameworkInstallPath,
  writeFrameworkMetadata,
} from '@/onboarding/manifest-writer.js';
import { writeStageAgents } from '@/stage-isolation/agent-writer.js';

export interface InstallResult {
  framework_home: string;
  project_root: string;
  version: string;
}

export interface BootstrapOptions {
  logger?: EngineLogger;
}

export function bootstrapFrameworkHome(): { framework_home: string } {
  const frameworkHome = resolveFrameworkInstallPath();
  const runtimeRoot = getRuntimeRoot();

  ensureFrameworkSymlink(runtimeRoot, frameworkHome);

  try {
    writeStageAgents();
  } catch {}

  return { framework_home: frameworkHome };
}

export function bootstrapFramework(projectRoot: string, options?: BootstrapOptions): InstallResult {
  if (options?.logger !== undefined) {
    setEngineLogger(options.logger);
  }

  const { framework_home: frameworkHome } = bootstrapFrameworkHome();

  writeFrameworkMetadata(projectRoot, VERSION);

  ensureSchemaMarkerSync(projectRoot, VERSION);

  return {
    framework_home: frameworkHome,
    project_root: projectRoot,
    version: VERSION,
  };
}

function ensureFrameworkSymlink(
  runtimeRoot: string,
  frameworkHome: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  mkdirSync(dirname(frameworkHome), { recursive: true });

  if (isPluginRuntime(env)) {
    repointFrameworkLinkPluginAware(runtimeRoot, frameworkHome, env);
    return;
  }

  if (isExpectedRuntimeSymlink(runtimeRoot, frameworkHome)) {
    return;
  }

  removeConflictingFrameworkPath(frameworkHome);

  try {
    symlinkSync(runtimeRoot, frameworkHome, frameworkSymlinkType());
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'EEXIST' &&
      isExpectedRuntimeSymlink(runtimeRoot, frameworkHome)
    ) {
      return;
    }
    throw error;
  }
}

function isPluginRuntime(env: NodeJS.ProcessEnv): boolean {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT;
  return typeof pluginRoot === 'string' && pluginRoot.length > 0;
}

function isNpmRuntime(target: string): boolean {
  return target.includes('node_modules');
}

function isPluginCacheRuntime(target: string): boolean {
  return target.includes('/plugins/') || target.includes('\\plugins\\');
}

function stableRuntimeHome(env: NodeJS.ProcessEnv): string | null {
  const data = env.CLAUDE_PLUGIN_DATA;
  return typeof data === 'string' && data.length > 0 ? join(data, 'runtime') : null;
}

function linkTarget(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

const RUNTIME_COPY_PARTS = ['package.json', 'dist', 'runtime'] as const;

function readPluginVersion(pluginRoot: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : null;
  } catch {
    return null;
  }
}

function runtimeCopyVersion(copyRoot: string): string | null {
  const st = lstatSafe(copyRoot);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) {
    return null;
  }
  try {
    return readFileSync(join(copyRoot, 'version'), 'utf8').trim();
  } catch {
    return null;
  }
}

function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function removeTreeQuietly(path: string): void {
  try {
    removeTree(path);
  } catch {
    return;
  }
}

function replaceRuntimeCopy(staging: string, copyRoot: string): void {
  const st = lstatSafe(copyRoot);
  let retired: string | null = null;
  if (st && st.isSymbolicLink()) {
    rmSync(copyRoot, { force: true, recursive: false });
  } else if (st) {
    retired = `${copyRoot}.old-${process.pid}`;
    removeTree(retired);
    renameWithRetrySync(copyRoot, retired, { remove: () => undefined });
  }
  renameWithRetrySync(staging, copyRoot, { remove: removeTreeQuietly });
  if (retired) {
    removeTreeQuietly(retired);
  }
}

function ensureStablePluginRuntime(pluginRuntime: string, env: NodeJS.ProcessEnv): string {
  const copyRoot = stableRuntimeHome(env);
  if (!copyRoot) {
    return pluginRuntime;
  }
  const pluginRoot = dirname(pluginRuntime);
  const linked = join(copyRoot, 'runtime');
  const staging = `${copyRoot}.tmp-${process.pid}`;
  try {
    const version = readPluginVersion(pluginRoot);
    if (!version) {
      return pluginRuntime;
    }
    if (runtimeCopyVersion(copyRoot) === version && existsSync(linked)) {
      return linked;
    }
    removeTree(staging);
    mkdirSync(staging, { recursive: true });
    for (const part of RUNTIME_COPY_PARTS) {
      const from = join(pluginRoot, part);
      if (existsSync(from)) {
        cpSync(from, join(staging, part), { recursive: true });
      }
    }
    writeFileSync(join(staging, 'version'), `${version}\n`, 'utf8');
    replaceRuntimeCopy(staging, copyRoot);
    return linked;
  } catch {
    removeTreeQuietly(staging);
    return pluginRuntime;
  }
}

function repointFrameworkLinkPluginAware(
  pluginRuntime: string,
  frameworkHome: string,
  env: NodeJS.ProcessEnv,
): void {
  const stat = lstatSafe(frameworkHome);

  if (stat && stat.isDirectory() && !stat.isSymbolicLink()) {
    return;
  }

  const stable = ensureStablePluginRuntime(pluginRuntime, env);

  if (stat && stat.isSymbolicLink()) {
    const target = linkTarget(frameworkHome);
    if (target) {
      if (target === stable) {
        return;
      }
      const targetStat = lstatSafe(target);
      if (targetStat && target !== stableRuntimeHome(env)) {
        if (isNpmRuntime(target)) {
          return;
        }
        if (!isPluginCacheRuntime(target) && target !== pluginRuntime) {
          return;
        }
      }
    }
  }

  try {
    mkdirSync(dirname(frameworkHome), { recursive: true });
    rmSync(frameworkHome, { force: true, recursive: false });
    symlinkSync(stable, frameworkHome, frameworkSymlinkType());
  } catch {}
}

export function frameworkSymlinkType(): 'junction' | undefined {
  return process.platform === 'win32' ? 'junction' : undefined;
}

function removeConflictingFrameworkPath(frameworkHome: string): void {
  const stat = lstatSafe(frameworkHome);
  if (stat === undefined) {
    return;
  }

  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new Error(
      `Refusing to replace existing framework home directory at ${frameworkHome}. Remove it manually or point PAQAD_FRAMEWORK_HOME at an empty path.`,
    );
  }

  rmSync(frameworkHome, { force: true, recursive: false });
}

function isExpectedRuntimeSymlink(runtimeRoot: string, frameworkHome: string): boolean {
  const stat = lstatSafe(frameworkHome);
  if (stat === undefined || !stat.isSymbolicLink()) {
    return false;
  }

  try {
    return readlinkSync(frameworkHome) === runtimeRoot;
  } catch {
    return false;
  }
}

function lstatSafe(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

export const __test = {
  ensureFrameworkSymlink,
  isPluginRuntime,
  repointFrameworkLinkPluginAware,
  ensureStablePluginRuntime,
  stableRuntimeHome,
  isNpmRuntime,
  isPluginCacheRuntime,
};
