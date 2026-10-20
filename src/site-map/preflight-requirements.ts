import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readProjectProfile } from '@/core/project-profile.js';
import type { PreflightRequirement, ProbeOutcome } from '@/workflow-preflight/contract.js';
import { execa } from 'execa';

import { artisanRunner, resolveArtisanInvocation } from './laravel-sources.js';
import { detectSiteMapPrerequisites } from './prerequisites.js';

const VERSION_CHECK_TIMEOUT_MS = 10_000;

function composerRequiresLaravel(projectRoot: string): boolean {
  try {
    const composer = JSON.parse(readFileSync(join(projectRoot, 'composer.json'), 'utf8')) as {
      require?: Record<string, string>;
    };
    return composer.require?.['laravel/framework'] !== undefined;
  } catch {
    return false;
  }
}

function nodeCliDiscoverable(projectRoot: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      bin?: unknown;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (
      deps['commander'] !== undefined ||
      deps['yargs'] !== undefined ||
      deps['oclif'] !== undefined
    ) {
      return true;
    }
    return pkg.bin !== undefined;
  } catch {
    return false;
  }
}

async function versionOk(bin: string, projectRoot: string): Promise<boolean> {
  try {
    const result = await execa(bin, ['--version'], {
      cwd: projectRoot,
      reject: false,
      timeout: VERSION_CHECK_TIMEOUT_MS,
    });
    return (typeof result.exitCode === 'number' ? result.exitCode : 1) === 0;
  } catch {
    return false;
  }
}

async function artisanRunnerPresent(projectRoot: string): Promise<boolean> {
  const invocation = resolveArtisanInvocation(
    readProjectProfile(projectRoot, { persistMigration: false })?.commands,
  );
  if ('blocked' in invocation) return false;
  switch (artisanRunner(invocation.argv)) {
    case 'sail':
      return existsSync(join(projectRoot, invocation.argv[0]!));
    case 'docker':
      return versionOk('docker', projectRoot);
    default:
      return versionOk('php', projectRoot);
  }
}

export const siteMapPreflightRequirements: PreflightRequirement[] = [
  {
    id: 'documentation-foundation',
    label: 'Documentation foundation',
    kind: 'workflow',
    why: 'The map is grouped and labelled from your project documentation, so it needs the documentation foundation first.',
    probe: async (projectRoot): Promise<ProbeOutcome> =>
      detectSiteMapPrerequisites(projectRoot).missing.some(
        (m) => m.workflow === 'create documentation',
      )
        ? 'unavailable'
        : 'ok',
    options: [
      { id: 'create-documentation', label: 'Run "create documentation" first', recommended: true },
    ],
  },
  {
    id: 'module-docs',
    label: 'Module documentation',
    kind: 'workflow',
    why: 'The map groups screens by module and labels them from the module docs, so it needs your modules documented first.',
    probe: async (projectRoot): Promise<ProbeOutcome> =>
      detectSiteMapPrerequisites(projectRoot).missing.some(
        (m) => m.workflow === 'create module documentation',
      )
        ? 'unavailable'
        : 'ok',
    options: [
      {
        id: 'create-module-documentation',
        label: 'Run "create module documentation" first',
        recommended: true,
      },
    ],
  },
  {
    id: 'node-cli-program',
    label: 'Node CLI program',
    kind: 'command',
    why: 'Without a discoverable command program the map cannot list your CLI commands as surfaces.',
    probe: async (projectRoot): Promise<ProbeOutcome> =>
      nodeCliDiscoverable(projectRoot) ? 'ok' : 'unavailable',
    options: [{ id: 'skip-cli', label: 'Skip CLI mapping for this run', recommended: true }],
  },
  {
    id: 'laravel-route-list',
    label: 'Laravel route list',
    kind: 'command',
    why: 'The real router resolves modular routes, middleware, and controllers that a static file scan cannot see.',
    applies: composerRequiresLaravel,
    probe: async (projectRoot): Promise<ProbeOutcome> => {
      const artisanPresent = existsSync(join(projectRoot, 'artisan'));
      const runnerPresent = await artisanRunnerPresent(projectRoot);
      return artisanPresent && runnerPresent ? 'needs-decision' : 'unavailable';
    },
    options: [
      { id: 'run', label: 'Let paqad run the read-only route list itself', recommended: true },
      { id: 'print', label: 'Print the command and paste the output back' },
      {
        id: 'static',
        label:
          'Fall back to the static route-file scan (loses module attribution and middleware the real router resolves)',
      },
    ],
  },
];
