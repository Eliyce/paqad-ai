import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readAgentRecord, readSkillRecord } from '@/feature-evidence/artifacts.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { agentOrchestratorEnabled, skillOrchestratorEnabled } from './config.js';
import { readTextIfPresent } from './fs-io.js';
import { hashAgentFile, hashFolder, listFolderFiles } from './hash.js';
import { agentHookScripts, lintAgentInProject, POWER_RULES } from './lint/agent-lint.js';
import { discoverInstalledAgents } from './overlap.js';
import { agentNameOf, readSkillPathContext, SKILL_FILE, skillFolderOf } from './paths.js';

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

export interface AgentCompletionFinding {
  agent: string;
  path: string;
  line: string;
}

export function agentCompletionLine(name: string): string {
  return `The agent ${name} changed but never went through its checks. Run paqad-ai agent status ${name}.`;
}

export function agentPowerLine(name: string, rules: readonly string[]): string {
  return `The agent ${name} holds a power with no current approval (${rules.join(', ')}): the authoring.agent_permission packet expired or is missing. Run paqad-ai agent test ${name} to ask again.`;
}

function hookScriptsOf(projectRoot: string, path: string): string[] {
  const text = readTextIfPresent(join(projectRoot, path));
  if (text === null) return [];
  const split = splitSkillFrontmatter(text);
  return split.ok ? agentHookScripts(projectRoot, split.data.hooks).scripts : [];
}

export function changedAgentFiles(
  projectRoot: string,
  changedFiles: readonly string[],
): Array<{ name: string; path: string }> {
  const context = readSkillPathContext(projectRoot);
  const found = new Map<string, { name: string; path: string }>();
  const scriptOwners = new Map<string, Array<{ name: string; path: string }>>();
  const owners = (): Map<string, Array<{ name: string; path: string }>> => {
    if (scriptOwners.size > 0) return scriptOwners;
    for (const agent of discoverInstalledAgents(projectRoot, context, { userHome: null })) {
      if (agent.scope !== 'project' || agent.path.endsWith('.toml')) continue;
      for (const script of hookScriptsOf(projectRoot, agent.path)) {
        scriptOwners.set(script, [
          ...(scriptOwners.get(script) ?? []),
          { name: agent.name, path: agent.path },
        ]);
      }
    }
    return scriptOwners;
  };
  for (const file of changedFiles) {
    const normal = file.replaceAll('\\', '/');
    const name = agentNameOf(normal, context.adapters, context);
    if (name !== null) {
      found.set(normal, { name, path: normal });
      continue;
    }
    for (const owner of owners().get(normal) ?? []) found.set(owner.path, owner);
  }
  return [...found.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function agentHashMatches(
  projectRoot: string,
  record: NonNullable<ReturnType<typeof readAgentRecord>>,
  path: string,
): boolean {
  const scripts = path.endsWith('.toml') ? [] : record.hook_scripts;
  const listed =
    record.files?.find((file) => file.path === path)?.hash ??
    (record.released_path === path ? record.file_hash : undefined);
  return listed !== undefined && listed === hashAgentFile(projectRoot, path, scripts);
}

function unapprovedPowers(projectRoot: string, path: string): string[] {
  if (path.endsWith('.toml') || path.endsWith('.hbs')) return [];
  const lint = lintAgentInProject(projectRoot, join(projectRoot, path));
  return [
    ...new Set(
      lint.findings
        .filter((finding) => finding.severity === 'block' && POWER_RULES.includes(finding.rule))
        .map((finding) => finding.rule),
    ),
  ].sort();
}

export function agentCompletionFindings(input: {
  projectRoot: string;
  dirName: string;
  changedFiles: readonly string[];
}): AgentCompletionFinding[] {
  if (!agentOrchestratorEnabled(input.projectRoot)) return [];
  const findings: AgentCompletionFinding[] = [];
  for (const { name, path } of changedAgentFiles(input.projectRoot, input.changedFiles)) {
    if (!existsSync(join(input.projectRoot, path))) continue;
    const record = readAgentRecord(input.projectRoot, input.dirName, name);
    const statusOk = record?.status === 'passed' || record?.status === 'overridden';
    if (!statusOk || record === null || !agentHashMatches(input.projectRoot, record, path)) {
      findings.push({ agent: name, path, line: agentCompletionLine(name) });
      continue;
    }
    const powers = unapprovedPowers(input.projectRoot, path);
    if (powers.length > 0) findings.push({ agent: name, path, line: agentPowerLine(name, powers) });
  }
  return findings;
}
