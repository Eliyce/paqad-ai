// Framework-install introspection for `paqad-ai doctor` (issue #616, Parts 4.6 + 9.4).
//
// The `~/.paqad-ai/current` link can now point at either the npm copy's `runtime/` or the Claude
// Code plugin's `runtime/`. Doctor reports which copy it resolves to and that copy's version, so an
// uninstalled npm package (a dangling link) or a plugin takeover is visible rather than silent.

import { existsSync, readFileSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Which copy the framework link resolves to. */
export type FrameworkCopy = 'plugin' | 'npm' | 'directory' | 'unknown';

export interface FrameworkLinkInfo {
  /** The link path itself (`~/.paqad-ai/current`, or `$PAQAD_FRAMEWORK_HOME`). */
  readonly home: string;
  /** The link's resolved target, or null when `home` is not a symlink. */
  readonly linkTarget: string | null;
  /** True when the resolved target (or a non-symlink `home`) exists on disk. */
  readonly targetExists: boolean;
  /** Which copy the target belongs to, inferred from its path. */
  readonly copy: FrameworkCopy;
  /** The target copy's `package.json` version (one level above `runtime/`), or null. */
  readonly version: string | null;
}

/** The link path every project's `.paqad/framework-path.txt` resolves to. */
export function frameworkLinkHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.PAQAD_FRAMEWORK_HOME ?? join(homedir(), '.paqad-ai', 'current');
}

/** The plugin's marketplace-qualified id, as Claude Code records it (issue #616, Part 7). */
export const PLUGIN_ID = 'paqad@eliyce';

/** Claude Code's record of installed plugins. */
export function installedPluginsPath(): string {
  return join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
}

/**
 * True when the paqad Claude Code plugin (`paqad@eliyce`) is installed. The updater reads this to
 * skip the Claude-specific writes (stage agents + `.claude` hooks) that the plugin now owns, so an
 * upgraded npm copy never double-wires them (issue #616, Part 7).
 */
export function isPluginInstalled(path: string = installedPluginsPath()): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return JSON.stringify(parsed).includes(PLUGIN_ID);
  } catch {
    return false;
  }
}

/** Read `<dir>/package.json`'s version, or null when absent/unreadable/malformed. */
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

/** Infer which copy a resolved runtime path belongs to from its location. */
export function classifyFrameworkCopy(target: string): FrameworkCopy {
  // The plugin runtime lives under Claude Code's plugin cache (…/plugins/…); the npm copy lives
  // under a node_modules tree. Checked in that order so a plugin inside node_modules (unusual) still
  // reads as a plugin.
  if (target.includes('/plugins/') || target.includes('\\plugins\\')) return 'plugin';
  if (target.includes('node_modules')) return 'npm';
  return 'unknown';
}

/** Describe what the framework link resolves to (issue #616, Part 4.6). */
export function describeFrameworkLink(env: NodeJS.ProcessEnv = process.env): FrameworkLinkInfo {
  const home = frameworkLinkHome(env);
  let linkTarget: string | null;
  try {
    linkTarget = readlinkSync(home);
  } catch {
    linkTarget = null;
  }

  if (linkTarget === null) {
    // Not a symlink: either absent, or a real directory (a PAQAD_FRAMEWORK_HOME override).
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
