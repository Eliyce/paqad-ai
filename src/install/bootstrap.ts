import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname } from 'node:path';

import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { VERSION } from '@/index.js';
import {
  resolveFrameworkInstallPath,
  writeFrameworkMetadata,
} from '@/onboarding/manifest-writer.js';

export interface InstallResult {
  framework_home: string;
  project_root: string;
  version: string;
}

export function bootstrapFramework(projectRoot: string): InstallResult {
  const frameworkHome = resolveFrameworkInstallPath();
  const runtimeRoot = getRuntimeRoot();

  ensureFrameworkSymlink(runtimeRoot, frameworkHome);

  writeFrameworkMetadata(projectRoot, VERSION);

  return {
    framework_home: frameworkHome,
    project_root: projectRoot,
    version: VERSION,
  };
}

function ensureFrameworkSymlink(runtimeRoot: string, frameworkHome: string): void {
  mkdirSync(dirname(frameworkHome), { recursive: true });

  if (isExpectedRuntimeSymlink(runtimeRoot, frameworkHome)) {
    return;
  }

  removeConflictingFrameworkPath(frameworkHome);

  try {
    symlinkSync(runtimeRoot, frameworkHome);
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

function removeConflictingFrameworkPath(frameworkHome: string): void {
  if (!existsSync(frameworkHome)) {
    return;
  }

  const stat = lstatSync(frameworkHome);
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new Error(
      `Refusing to replace existing framework home directory at ${frameworkHome}. Remove it manually or point PAQAD_FRAMEWORK_HOME at an empty path.`,
    );
  }

  rmSync(frameworkHome, { force: true, recursive: false });
}

function isExpectedRuntimeSymlink(runtimeRoot: string, frameworkHome: string): boolean {
  if (!existsSync(frameworkHome)) {
    return false;
  }

  try {
    const stat = lstatSync(frameworkHome);
    return stat.isSymbolicLink() && readlinkSync(frameworkHome) === runtimeRoot;
  } catch {
    return false;
  }
}
