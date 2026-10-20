import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readProjectProfile } from '@/core/project-profile.js';

import { isUndecidedCommand } from './create-project.js';

export interface ReadinessResult {
  ready: boolean;
  checks: {
    commandsConfigured: boolean;
    moduleDocsPresent: boolean;
  };
  blockers: string[];
}

export function verifyReadinessToDevelop(projectRoot: string): ReadinessResult {
  const blockers: string[] = [];

  const profile = readProjectProfile(projectRoot, { persistMigration: false });

  let commandsConfigured = false;
  if (!profile) {
    blockers.push(`no project profile found at ${PATHS.PROJECT_PROFILE}`);
  } else {
    const commands = profile.commands;
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
