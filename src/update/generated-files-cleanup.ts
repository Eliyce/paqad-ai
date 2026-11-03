import { existsSync, readdirSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readTextIfExistsSync } from '@/core/fs/read-if-exists.js';
import { teamConfigPath } from '@/core/team-config.js';
import { TEAM_CONFIG_FILES, type OwnTeamConfigFile } from '@/core/team-config-values.js';
import { unexcludeLocally } from '@/onboarding/gitignore-writer.js';
import {
  FEATURE_DEVELOPMENT_VIEW_RELATIVE,
  featureDevelopmentViewPath,
  isGeneratedView,
} from '@/pipeline/feature-development-view.js';

import { LEGACY_SCHEMA_LINE_PREFIX } from './legacy-schema-line.js';

const LEGACY_VIEW_HASH = '.paqad/state/feature-development-view.sha256';
const LEGACY_SCHEMAS_DIR = `${PATHS.PROJECT_CONFIGS_DIR}/schemas`;
const INSTRUCTIONS_DIR = 'docs/instructions';

type Step = () => string | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stayedLine(item: string, error: unknown): string {
  return `Couldn't remove ${item}, so it stayed: ${errorMessage(error)}. paqad tries again on the next update or join.`;
}

function removeGeneratedCopy(projectRoot: string): Step {
  return () => {
    const path = featureDevelopmentViewPath(projectRoot);
    const text = readTextIfExistsSync(path);
    if (text === null || !isGeneratedView(text)) return null;
    rmSync(path);
    return `Removed the generated workflow copy ${FEATURE_DEVELOPMENT_VIEW_RELATIVE}; paqad reads .paqad/configs/ directly.`;
  };
}

function removeViewHash(projectRoot: string): Step {
  return () => {
    const path = join(projectRoot, LEGACY_VIEW_HASH);
    if (!existsSync(path)) return null;
    rmSync(path);
    return `Removed ${LEGACY_VIEW_HASH}, which paqad used to check the workflow copy.`;
  };
}

function removeExcludeLine(projectRoot: string): Step {
  return () =>
    unexcludeLocally(projectRoot, FEATURE_DEVELOPMENT_VIEW_RELATIVE)
      ? `Removed the line for ${FEATURE_DEVELOPMENT_VIEW_RELATIVE} from .git/info/exclude.`
      : null;
}

function removeEmptyFolder(projectRoot: string, relative: string): Step {
  return () => {
    const path = join(projectRoot, relative);
    if (!existsSync(path) || readdirSync(path).length > 0) return null;
    rmdirSync(path);
    return `Removed the empty ${relative}/ folder.`;
  };
}

function removeSchemas(projectRoot: string): Step {
  return () => {
    const path = join(projectRoot, LEGACY_SCHEMAS_DIR);
    if (!existsSync(path)) return null;
    rmSync(path, { recursive: true });
    return `Removed ${LEGACY_SCHEMAS_DIR}/; paqad no longer writes editor schemas.`;
  };
}

function removeSchemaLine(projectRoot: string, file: OwnTeamConfigFile): Step {
  return () => {
    const path = teamConfigPath(projectRoot, file);
    const raw = readTextIfExistsSync(path);
    if (raw === null) return null;
    const text = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
    if (!text.startsWith(LEGACY_SCHEMA_LINE_PREFIX)) return null;
    const end = text.indexOf('\n');
    writeFileSync(path, end === -1 ? '' : text.slice(end + 1), 'utf8');
    return `Removed the schema line at the top of ${PATHS.PROJECT_CONFIGS_DIR}/${file}.`;
  };
}

function run(item: string, step: Step, lines: string[]): void {
  try {
    const line = step();
    if (line !== null) lines.push(line);
  } catch (error) {
    lines.push(stayedLine(item, error));
  }
}

export function removeGeneratedFiles(projectRoot: string): string[] {
  const lines: string[] = [];
  run(FEATURE_DEVELOPMENT_VIEW_RELATIVE, removeGeneratedCopy(projectRoot), lines);
  run(LEGACY_VIEW_HASH, removeViewHash(projectRoot), lines);
  run(
    `the ${FEATURE_DEVELOPMENT_VIEW_RELATIVE} line in .git/info/exclude`,
    removeExcludeLine(projectRoot),
    lines,
  );
  run(`${PATHS.WORKFLOWS_DIR}/`, removeEmptyFolder(projectRoot, PATHS.WORKFLOWS_DIR), lines);
  run(`${INSTRUCTIONS_DIR}/`, removeEmptyFolder(projectRoot, INSTRUCTIONS_DIR), lines);
  run(`${LEGACY_SCHEMAS_DIR}/`, removeSchemas(projectRoot), lines);
  for (const file of TEAM_CONFIG_FILES) {
    run(
      `the schema line at the top of ${PATHS.PROJECT_CONFIGS_DIR}/${file}`,
      removeSchemaLine(projectRoot, file),
      lines,
    );
  }
  return lines;
}
