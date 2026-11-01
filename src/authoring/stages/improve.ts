import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gitPathList } from '@/pipeline/git-paths.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { isMissingPathError, readRegularFile, readTextIfPresent } from '../fs-io.js';
import { agentHookScripts } from '../lint/agent-lint.js';
import { isPaqadRuntimeSkill } from '../lint/skill-lint.js';
import { discoverInstalledAgents, discoverInstalledSkills } from '../overlap.js';
import { readSkillPathContext, SKILL_FILE } from '../paths.js';
import {
  AuthoringRefusal,
  MODE_FILE,
  readMode,
  TRACKED_ROOT,
  type AuthoringWorkspace,
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

export const MERGE_BASE_REF = 'origin/main';

export function existedAtMergeBase(projectRoot: string, folder: string): boolean | null {
  const base = gitPathList(projectRoot, ['merge-base', 'HEAD', MERGE_BASE_REF])?.[0]?.trim();
  if (!base) return null;
  return gitPathList(projectRoot, ['cat-file', '-e', `${base}:${folder}/${SKILL_FILE}`]) !== null;
}

function newRuntimeSkill(projectRoot: string, folder: string): boolean {
  return (
    isPaqadRuntimeSkill(projectRoot, join(projectRoot, folder)) &&
    existedAtMergeBase(projectRoot, folder) === false
  );
}

export function isRegisteredSkill(workspace: SkillWorkspace): boolean {
  if (existsSync(join(workspace.projectRoot, TRACKED_ROOT, workspace.name, 'evidence.json'))) {
    return true;
  }
  const folder = installedSkillFolder(workspace);
  return folder !== null && !newRuntimeSkill(workspace.projectRoot, folder);
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

export const AGENT_SNAPSHOT_DIR = 'agent-snapshot';

export function installedAgentFile(workspace: AuthoringWorkspace): string | null {
  const context = readSkillPathContext(workspace.projectRoot);
  const found = discoverInstalledAgents(workspace.projectRoot, context, { userHome: null }).find(
    (agent) => agent.name === workspace.name && agent.scope === 'project',
  );
  return found?.path ?? null;
}

function readAgentSource(abs: string): string | null {
  try {
    return readRegularFile(abs, false)?.buffer.toString('utf8') ?? null;
  } catch (error) {
    if (isMissingPathError(error) || (error as NodeJS.ErrnoException).code === 'ELOOP') {
      return null;
    }
    throw error;
  }
}

export function runAgentImprove(
  workspace: AuthoringWorkspace,
  input: { source?: string } = {},
): StageResult {
  const source = input.source ?? installedAgentFile(workspace);
  if (source === null) {
    throw new AuthoringRefusal(
      `There is no installed agent named ${workspace.name}. For a new agent, start with paqad-ai agent justify ${workspace.name}.`,
    );
  }
  const text = readAgentSource(join(workspace.projectRoot, source));
  if (text === null) {
    throw new AuthoringRefusal(`${source} is not an agent file.`, 2);
  }
  const lines: string[] = [];
  if (workspace.exists(AGENT_SNAPSHOT_DIR)) {
    lines.push(
      `The snapshot in ${workspace.relPath(AGENT_SNAPSHOT_DIR)} already exists; I kept it as the old_agent baseline.`,
    );
  } else {
    workspace.write(`${AGENT_SNAPSHOT_DIR}/${workspace.name}.md`, text);
    const split = splitSkillFrontmatter(text);
    const scripts = split.ok
      ? agentHookScripts(workspace.projectRoot, split.data.hooks).scripts
      : [];
    for (const script of scripts) {
      const scriptText = readTextIfPresent(join(workspace.projectRoot, script));
      if (scriptText !== null) workspace.write(`${AGENT_SNAPSHOT_DIR}/${script}`, scriptText);
    }
    lines.push(
      `Snapshotted ${source}${scripts.length > 0 ? ` and ${scripts.join(', ')}` : ''} to ${workspace.relPath(AGENT_SNAPSHOT_DIR)}; it is the old_agent baseline.`,
    );
  }
  const mode: WorkspaceMode = { entry: 'improve', source };
  if (readMode(workspace).entry !== 'improve') workspace.writeJson(MODE_FILE, mode);
  lines.push(
    workspace.exists('intake.yaml')
      ? `Improve mode: S0 and S1 are skipped. Next: paqad-ai agent evidence ${workspace.name} <sources.md>`
      : `Improve mode: S0 is skipped. Next: paqad-ai agent intake ${workspace.name} <intake.yaml>`,
  );
  return stageResult(true, lines, [
    workspace.relPath(AGENT_SNAPSHOT_DIR),
    workspace.relPath(MODE_FILE),
  ]);
}
