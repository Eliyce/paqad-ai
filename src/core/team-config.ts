import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { stampLastApplied } from '@/git-workflow/last-applied.js';

import { PATHS } from './constants/paths.js';
import {
  checkoutIsNewer,
  FRAMEWORK_CONFIG_SPECS,
  type FrameworkConfigSpec,
} from './framework-config.js';
import { writeTeamConfigSchemas } from './team-config-schema.js';
import { readLegacyTeamConfig, type LegacyCollision } from './team-config-legacy.js';
import {
  checkYamlValue,
  fromYamlValue,
  GIT_WORKFLOW_COMMITS_FILE,
  TEAM_CONFIG_FILE_DESCRIPTIONS,
  TEAM_CONFIG_FILES,
  toYamlValue,
  type TeamConfigFile,
} from './team-config-values.js';

declare const __PKG_VERSION__: string;

export const TEAM_CONFIG_READ_FILES: readonly TeamConfigFile[] = [
  ...TEAM_CONFIG_FILES,
  GIT_WORKFLOW_COMMITS_FILE,
];

export interface TeamConfigIssue {
  file: TeamConfigFile;
  key?: string;
  path?: string;
  message: string;
}

export interface TeamConfigRead {
  merged: Map<string, string>;
  collisions: LegacyCollision[];
  sources: Map<string, string>;
  issues: TeamConfigIssue[];
}

export function teamConfigPath(projectRoot: string, file: TeamConfigFile): string {
  return join(projectRoot, PATHS.PROJECT_CONFIGS_DIR, file);
}

export function teamConfigSchemaRef(file: TeamConfigFile): string {
  const name = file
    .split('/')
    .pop()!
    .replace(/\.yaml$/u, '');
  return file.includes('/')
    ? `../schemas/${file.split('/')[0]}/${name}.schema.json`
    : `./schemas/${name}.schema.json`;
}

export function teamConfigHeader(file: TeamConfigFile, version: string = __PKG_VERSION__): string {
  return [
    `# yaml-language-server: $schema=${teamConfigSchemaRef(file)}`,
    `# ${TEAM_CONFIG_FILE_DESCRIPTIONS[file]}`,
    "# Only settings this team changed live here; everything else uses paqad's default.",
    '# See every setting, its value and where it comes from: paqad-ai config show',
    `paqad_version: "${version}"`,
    '',
  ].join('\n');
}

function renderValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function invalidValueMessage(
  spec: FrameworkConfigSpec,
  value: unknown,
  reason: string,
): string {
  const def =
    spec.default === undefined ? '(unset)' : renderValue(toYamlValue(spec, String(spec.default)));
  return (
    `${spec.file}: ${spec.path.join('.')} has an invalid value ${renderValue(value)}, ` +
    `so paqad uses the default ${def}. ${reason}`
  );
}

export function invalidFileMessage(file: TeamConfigFile, parserMessage: string): string {
  return `${file} isn't valid YAML, so none of its settings are used: ${parserMessage}`;
}

export function readTeamYamlFile(
  projectRoot: string,
  file: TeamConfigFile,
): { document: YAML.Document | null; error?: string } {
  const path = teamConfigPath(projectRoot, file);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { document: null };
  }
  const document = YAML.parseDocument(text);
  if (document.errors.length > 0) {
    return { document: null, error: document.errors[0]!.message.split('\n')[0]! };
  }
  return { document };
}

export function valueAt(data: unknown, path: readonly string[]): unknown {
  let node: unknown = data;
  for (const segment of path) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

export function readTeamConfig(projectRoot: string): TeamConfigRead {
  const merged = new Map<string, string>();
  const sources = new Map<string, string>();
  const issues: TeamConfigIssue[] = [];
  const claimed = new Set<string>();
  for (const file of TEAM_CONFIG_READ_FILES) {
    const { document, error } = readTeamYamlFile(projectRoot, file);
    if (error !== undefined) {
      issues.push({ file, message: invalidFileMessage(file, error) });
      continue;
    }
    if (document === null) continue;
    const data: unknown = document.toJS();
    for (const spec of FRAMEWORK_CONFIG_SPECS) {
      if (spec.file !== file) continue;
      const value = valueAt(data, spec.path);
      if (value === undefined || value === null) continue;
      claimed.add(spec.key);
      const reason = checkYamlValue(spec, value);
      if (reason !== null) {
        issues.push({
          file,
          key: spec.key,
          path: spec.path.join('.'),
          message: invalidValueMessage(spec, value, reason),
        });
        continue;
      }
      merged.set(spec.key, fromYamlValue(spec, value));
      sources.set(spec.key, teamConfigPath(projectRoot, file));
    }
  }
  const legacy = readLegacyTeamConfig(projectRoot);
  for (const [key, value] of legacy.merged) {
    if (claimed.has(key)) continue;
    merged.set(key, value);
    sources.set(key, legacy.sources.get(key)!);
  }
  return { merged, collisions: legacy.collisions, sources, issues };
}

export function writeTeamYamlValue(
  projectRoot: string,
  file: TeamConfigFile,
  path: readonly string[],
  value: unknown,
): string {
  const target = teamConfigPath(projectRoot, file);
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : teamConfigHeader(file);
  const document = YAML.parseDocument(existing);
  if (document.errors.length > 0) {
    throw new Error(invalidFileMessage(file, document.errors[0]!.message));
  }
  document.setIn([...path], value);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, document.toString({ lineWidth: 0 }), 'utf8');
  if (file === GIT_WORKFLOW_COMMITS_FILE) {
    stampLastApplied(projectRoot, ['commits.yaml']);
  }
  return target;
}

export function setTeamConfigValue(projectRoot: string, key: string, legacyValue: string): string {
  const spec = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === key);
  if (spec === undefined) {
    throw new Error(`${key} isn't a paqad setting.`);
  }
  return writeTeamYamlValue(projectRoot, spec.file, spec.path, toYamlValue(spec, legacyValue));
}

export function ensureTeamConfigFiles(projectRoot: string): string[] {
  const created: string[] = [];
  for (const file of TEAM_CONFIG_FILES) {
    const path = teamConfigPath(projectRoot, file);
    if (existsSync(path)) continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, teamConfigHeader(file), 'utf8');
    created.push(path);
  }
  return created;
}

export function syncTeamConfigFiles(projectRoot: string): string[] {
  if (checkoutIsNewer(projectRoot)) return [];
  writeTeamConfigSchemas(projectRoot);
  return ensureTeamConfigFiles(projectRoot);
}
