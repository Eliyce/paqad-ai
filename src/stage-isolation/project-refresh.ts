import { join } from 'node:path';

import { enabledAdapters } from '@/authoring/paths.js';
import {
  AGENTS_IGNORE_LINES,
  folderIgnoreIsSymlink,
  writeFolderIgnoreBlock,
} from '@/onboarding/gitignore-writer.js';
import {
  PROJECT_AGENTS_DIR,
  syncProjectStageAgents,
  type ProjectAgentSync,
} from '@/onboarding/stage-agent-migration.js';

import { syncCodexRecipes } from './recipe-install.js';

const CLAUDE_ADAPTER = 'claude-code';

export function refreshProjectAgents(projectRoot: string): ProjectAgentSync {
  const folder = join(projectRoot, PROJECT_AGENTS_DIR);
  const ignoreIsLink = folderIgnoreIsSymlink(folder);
  writeFolderIgnoreBlock(folder, AGENTS_IGNORE_LINES);
  const sync = syncProjectStageAgents(projectRoot);
  return ignoreIsLink
    ? { ...sync, symlinks: [...sync.symlinks, `${PROJECT_AGENTS_DIR}/.gitignore`] }
    : sync;
}

export interface ProjectRefresh {
  agents: ProjectAgentSync | null;
  recipes: string[];
  symlinks: string[];
}

export function refreshPaqadProjectFiles(projectRoot: string): ProjectRefresh {
  const agents = enabledAdapters(projectRoot).includes(CLAUDE_ADAPTER)
    ? refreshProjectAgents(projectRoot)
    : null;
  const recipes = syncCodexRecipes(projectRoot);
  return {
    agents,
    recipes: recipes.written,
    symlinks: [...(agents?.symlinks ?? []), ...recipes.symlinks],
  };
}
