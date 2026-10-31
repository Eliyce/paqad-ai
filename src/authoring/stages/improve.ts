import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { discoverInstalledSkills } from '../overlap.js';
import { readSkillPathContext, SKILL_FILE } from '../paths.js';
import {
  AuthoringRefusal,
  MODE_FILE,
  readMode,
  TRACKED_ROOT,
  type SkillWorkspace,
  type WorkspaceMode,
} from '../workspace.js';
import { stageResult, type StageResult } from './result.js';

export const SNAPSHOT_DIR = 'skill-snapshot';

export function installedSkillFolder(workspace: SkillWorkspace): string | null {
  const context = readSkillPathContext(workspace.projectRoot);
  const found = discoverInstalledSkills(workspace.projectRoot, context, { userHome: null }).find(
    (skill) => skill.name === workspace.name,
  );
  return found ? found.path.slice(0, -`/${SKILL_FILE}`.length) : null;
}

export function isRegisteredSkill(workspace: SkillWorkspace): boolean {
  return (
    installedSkillFolder(workspace) !== null ||
    existsSync(join(workspace.projectRoot, TRACKED_ROOT, workspace.name, 'evidence.json'))
  );
}

function snapshot(workspace: SkillWorkspace, sourceAbs: string, prefix = ''): number {
  let count = 0;
  for (const name of readdirSync(join(sourceAbs, prefix)).sort()) {
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    const stat = lstatSync(join(sourceAbs, rel));
    if (stat.isSymbolicLink()) {
      throw new AuthoringRefusal(`improve refused: ${rel} in the installed skill is a symlink.`);
    }
    if (stat.isDirectory()) {
      count += snapshot(workspace, sourceAbs, rel);
      continue;
    }
    workspace.write(`${SNAPSHOT_DIR}/${rel}`, readFileSync(join(sourceAbs, rel), 'utf8'));
    count += 1;
  }
  return count;
}

export function runImprove(
  workspace: SkillWorkspace,
  input: { source?: string } = {},
): StageResult {
  const source = input.source ?? installedSkillFolder(workspace);
  if (source === null) {
    throw new AuthoringRefusal(
      `There is no installed skill named ${workspace.name}. For a new skill, start with paqad-ai skill justify ${workspace.name}.`,
    );
  }
  const sourceAbs = join(workspace.projectRoot, source);
  if (!existsSync(join(sourceAbs, SKILL_FILE))) {
    throw new AuthoringRefusal(`${source} holds no ${SKILL_FILE}.`, 2);
  }
  const lines: string[] = [];
  if (workspace.exists(SNAPSHOT_DIR)) {
    lines.push(
      `The snapshot in ${workspace.relPath(SNAPSHOT_DIR)} already exists; I kept it as the baseline.`,
    );
  } else {
    const files = snapshot(workspace, sourceAbs);
    lines.push(
      `Snapshotted ${files} file${files === 1 ? '' : 's'} of ${source} to ${workspace.relPath(SNAPSHOT_DIR)}; it is the baseline.`,
    );
  }
  const mode: WorkspaceMode = { entry: 'improve', source };
  if (readMode(workspace).entry !== 'improve') workspace.writeJson(MODE_FILE, mode);
  const intake = workspace.exists('intake.yaml');
  lines.push(
    intake
      ? `Improve mode: S0 and S1 are skipped. Next: paqad-ai skill evidence ${workspace.name} <sources.md>`
      : `Improve mode: S0 is skipped. Next: paqad-ai skill intake ${workspace.name} <intake.yaml>`,
  );
  return stageResult(true, lines, [workspace.relPath(SNAPSHOT_DIR), workspace.relPath(MODE_FILE)]);
}
