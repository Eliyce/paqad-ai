import { existsSync, readFileSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type FrameworkCopy = 'plugin' | 'npm' | 'directory' | 'unknown';

export interface FrameworkLinkInfo {
  readonly home: string;
  readonly linkTarget: string | null;
  readonly targetExists: boolean;
  readonly copy: FrameworkCopy;
  readonly version: string | null;
}

export function frameworkLinkHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PAQAD_FRAMEWORK_HOME ?? join(homedir(), '.paqad-ai', 'current');
}

export const PLUGIN_ID = 'paqad@eliyce';

export function installedPluginsPath(): string {
  return join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
}

export function isPluginInstalled(path: string = installedPluginsPath()): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return JSON.stringify(parsed).includes(PLUGIN_ID);
  } catch {
    return false;
  }
}

export function readPackageVersion(dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

export function readRuntimeCopyVersion(copyRoot: string): string | null {
  try {
    const version = readFileSync(join(copyRoot, 'version'), 'utf8').trim();
    return version === '' ? null : version;
  } catch {
    return null;
  }
}

function readCopyVersion(dir: string): string | null {
  return readPackageVersion(dir) ?? readRuntimeCopyVersion(dir);
}

export function classifyFrameworkCopy(target: string): FrameworkCopy {
  if (target.includes('/plugins/') || target.includes('\\plugins\\')) return 'plugin';
  if (target.includes('node_modules')) return 'npm';
  return 'unknown';
}

export function describeFrameworkLink(env: NodeJS.ProcessEnv = process.env): FrameworkLinkInfo {
  const home = frameworkLinkHome(env);
  let linkTarget: string | null;
  try {
    linkTarget = readlinkSync(home);
  } catch {
    linkTarget = null;
  }

  if (linkTarget === null) {
    const isDir = existsSync(home);
    return {
      home,
      linkTarget: null,
      targetExists: isDir,
      copy: isDir ? 'directory' : 'unknown',
      version: isDir ? readCopyVersion(dirname(home)) : null,
    };
  }

  const targetExists = existsSync(linkTarget);
  return {
    home,
    linkTarget,
    targetExists,
    copy: targetExists ? classifyFrameworkCopy(linkTarget) : 'unknown',
    version: targetExists ? readCopyVersion(dirname(linkTarget)) : null,
  };
}
