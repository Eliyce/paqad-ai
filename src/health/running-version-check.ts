import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { getPackageRoot } from '@/core/runtime-paths.js';
import type { HealthCheckResult } from '@/core/types/health.js';
import { versionAtLeast } from '@/core/version-compare.js';
import { readFrameworkVersion } from '@/onboarding/manifest-writer.js';

import { PLUGIN_ID } from './plugin-install.js';

declare const __PKG_VERSION__: string;

const PLUGIN_BINARY_PATH = /\/plugins\/(?:cache|marketplaces)\//u;
const RELEASED_VERSION = /^\d+\.\d+\.\d+/u;

export const NPM_UPDATE_COMMAND = 'npm i -g paqad-ai@latest';
export const PLUGIN_UPDATE_COMMAND = `claude plugin update ${PLUGIN_ID}`;

export function runningFromPlugin(packageRoot: string = getPackageRoot()): boolean {
  return PLUGIN_BINARY_PATH.test(`${packageRoot.replaceAll('\\', '/')}/`);
}

export interface RunningVersionOptions {
  running?: string;
  packageRoot?: string;
}

function updateAdvice(packageRoot: string): string {
  return runningFromPlugin(packageRoot)
    ? `Run ${PLUGIN_UPDATE_COMMAND}, then start a new session, because this session's PATH still points at the old one.`
    : `Run ${NPM_UPDATE_COMMAND}.`;
}

export function runningVersionHealth(
  projectRoot: string,
  options: RunningVersionOptions = {},
): HealthCheckResult[] {
  const running = options.running ?? __PKG_VERSION__;
  const repo = readFrameworkVersion(join(projectRoot, PATHS.FRAMEWORK_VERSION));
  const repoCore = repo === null ? undefined : RELEASED_VERSION.exec(repo)?.[0];
  if (repoCore === undefined || versionAtLeast(running, repoCore)) return [];
  const advice = updateAdvice(options.packageRoot ?? getPackageRoot());
  return [
    {
      name: 'paqad-ai version',
      status: 'warning',
      detail: `This paqad-ai is ${running}, but this repo was last updated with ${repo} on this machine. ${advice}`,
      remediation: advice,
    },
  ];
}
