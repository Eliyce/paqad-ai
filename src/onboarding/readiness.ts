import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readProjectProfile } from '@/core/project-profile.js';

/**
 * The marker prefix every UNDECIDED placeholder command carries (see `UNDECIDED_COMMANDS` in
 * `create-project.ts`). A created-but-undecided workspace records these self-explaining no-ops in
 * place of framework defaults, so matching the prefix is how readiness tells "no stack chosen yet"
 * apart from a real command. Kept as a prefix (not an exact string) so a future placeholder wording
 * still reads as undecided.
 */
const UNDECIDED_COMMAND_PREFIX = 'echo "choose an application stack';

export interface ReadinessResult {
  ready: boolean;
  checks: {
    commandsConfigured: boolean;
    moduleDocsPresent: boolean;
  };
  blockers: string[];
}

/**
 * Verify a project is ready to develop (FR-7). After a stack is installed and onboarded, creation
 * must prove readiness before declaring setup complete: the applicable start/build/check commands
 * resolve to real commands, and module documentation exists. This is honest by construction — an
 * undecided workspace (whose commands are still the `echo "choose an application stack…"`
 * placeholders) is NOT ready, so it can never be reported ready.
 *
 * Deterministic and zero-token: it reuses {@link readProjectProfile} and a `docs/modules/` check,
 * never a model call and never a shelled-out command.
 */
export function verifyReadinessToDevelop(projectRoot: string): ReadinessResult {
  const blockers: string[] = [];

  const profile = readProjectProfile(projectRoot, { persistMigration: false });

  let commandsConfigured = false;
  if (!profile) {
    blockers.push(`no project profile found at ${PATHS.PROJECT_PROFILE}`);
  } else {
    const commands = profile.commands;
    // The applicable start (dev), build and check (test) commands must resolve to real commands.
    const relevant = [commands.dev, commands.build, commands.test];
    const stillUndecided = relevant.some((command) => isUndecidedCommand(command));
    commandsConfigured = !stillUndecided;
    if (stillUndecided) {
      blockers.push('application stack still undecided');
    }
  }

  const moduleDocsPresent = hasModuleDocs(projectRoot);
  if (!moduleDocsPresent) {
    blockers.push(`module documentation missing (${PATHS.MODULES_DIR}/ is absent or empty)`);
  }

  const ready = commandsConfigured && moduleDocsPresent;

  return {
    ready,
    checks: { commandsConfigured, moduleDocsPresent },
    blockers,
  };
}

function isUndecidedCommand(command: string): boolean {
  return command.trim().startsWith(UNDECIDED_COMMAND_PREFIX);
}

function hasModuleDocs(projectRoot: string): boolean {
  const modulesDir = join(projectRoot, PATHS.MODULES_DIR);
  if (!existsSync(modulesDir)) {
    return false;
  }
  try {
    return readdirSync(modulesDir).length > 0;
  } catch {
    return false;
  }
}
