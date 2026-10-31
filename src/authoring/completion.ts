import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readSkillRecord } from '@/feature-evidence/artifacts.js';

import { skillOrchestratorEnabled } from './config.js';
import { hashFolder, listFolderFiles } from './hash.js';
import { readSkillPathContext, SKILL_FILE, skillFolderOf } from './paths.js';

export interface SkillCompletionFinding {
  skill: string;
  folder: string;
  line: string;
}

export function skillCompletionLine(name: string): string {
  return `The skill ${name} changed but never went through its checks. Run paqad-ai skill status ${name}.`;
}

export function changedSkillFolders(
  projectRoot: string,
  changedFiles: readonly string[],
): Array<{ name: string; folder: string }> {
  const context = readSkillPathContext(projectRoot);
  const folders = new Map<string, { name: string; folder: string }>();
  for (const file of changedFiles) {
    const match = skillFolderOf(file, context.adapters, context);
    if (match) folders.set(match.folder, match);
  }
  return [...folders.values()].sort((left, right) =>
    left.folder < right.folder ? -1 : left.folder > right.folder ? 1 : 0,
  );
}

function folderRemoved(projectRoot: string, folder: string): boolean {
  const abs = join(projectRoot, folder);
  return !existsSync(abs) || listFolderFiles(abs).length === 0;
}

export function skillCompletionFindings(input: {
  projectRoot: string;
  dirName: string;
  changedFiles: readonly string[];
}): SkillCompletionFinding[] {
  if (!skillOrchestratorEnabled(input.projectRoot)) return [];
  const findings: SkillCompletionFinding[] = [];
  for (const { name, folder } of changedSkillFolders(input.projectRoot, input.changedFiles)) {
    if (folderRemoved(input.projectRoot, folder)) continue;
    const record = readSkillRecord(input.projectRoot, input.dirName, name);
    const statusOk = record?.status === 'passed' || record?.status === 'overridden';
    const abs = join(input.projectRoot, folder);
    const hashOk =
      record !== null &&
      record.released_path === folder &&
      existsSync(join(abs, SKILL_FILE)) &&
      record.folder_hash === hashFolder(abs);
    if (!statusOk || !hashOk) {
      findings.push({ skill: name, folder, line: skillCompletionLine(name) });
    }
  }
  return findings;
}
