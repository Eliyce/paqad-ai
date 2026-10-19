// The site-map workflow's preflight requirement list (issue: site-map rebuild S3b, fixing D5/D6).
//
// Before a mapping run starts, preflight checks everything it needs and asks the person once. Each
// requirement here declares one thing the run needs, a read-only probe for whether it is met, and
// what to ask when it is not. Two rules hold throughout:
//   - a probe never executes project code that boots the app. `laravel-route-list` checks that the
//     way the project runs artisan is present (Sail, docker, or host PHP, issue #500), not that
//     `artisan route:list` runs, because running it boots the user's app, which is exactly the
//     choice DEC-1 governs. Preflight asks first; the resolved answer (`run`)
//     decides whether the gatherer runs it later.
//   - the documentation-family requirements delegate to `detectSiteMapPrerequisites` rather than
//     re-deriving the foundation and module-docs signals.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readProjectProfile } from '@/core/project-profile.js';
import type { PreflightRequirement, ProbeOutcome } from '@/workflow-preflight/contract.js';
import { execa } from 'execa';

import { artisanRunner, resolveArtisanInvocation } from './laravel-sources.js';
import { detectSiteMapPrerequisites } from './prerequisites.js';

/** Best-effort timeout for a `--version` presence check; a hung binary must not stall preflight. */
const VERSION_CHECK_TIMEOUT_MS = 10_000;

/** True when composer.json requires laravel/framework, so the Laravel requirement is declared. */
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

/** True when a Node CLI program is discoverable from package.json (a CLI dep or a bin entry). */
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

/**
 * Whether `<bin> --version` exits cleanly. Read-only presence check only — it never runs
 * `artisan route:list` or any command that boots the app. Any failure (missing binary, timeout)
 * is `false`, so preflight degrades to a question rather than throwing.
 */
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

/**
 * Whether the way this project runs artisan is present (issue #500): the Sail script exists,
 * docker answers `docker --version`, or host PHP answers `php --version`. A migrate command
 * still holding a placeholder blocks artisan, so it reads as not runnable.
 */
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

/** The requirements the site-map workflow checks before it runs. */
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
    // Declared only for a Laravel project (DEC-1 governs whether the gatherer runs it later).
    applies: composerRequiresLaravel,
    // Presence, not execution: an artisan file plus a present runner means the command COULD run,
    // which is a decision (DEC-1); a missing runner means it cannot, which is a plain gap. Never
    // spawns `artisan route:list` — that would boot the user's app before the person has decided.
    probe: async (projectRoot): Promise<ProbeOutcome> => {
      const artisanPresent = existsSync(join(projectRoot, 'artisan'));
      const runnerPresent = await artisanRunnerPresent(projectRoot);
      return artisanPresent && runnerPresent ? 'needs-decision' : 'unavailable';
    },
    options: [
      // DEC-1 resolved `run`: paqad executes the read-only command itself.
      { id: 'run', label: 'Let paqad run the read-only route list itself', recommended: true },
      // The option the user did not pick, kept available.
      { id: 'print', label: 'Print the command and paste the output back' },
      // A third fallback, with what it costs.
      {
        id: 'static',
        label:
          'Fall back to the static route-file scan (loses module attribution and middleware the real router resolves)',
      },
    ],
  },
];
