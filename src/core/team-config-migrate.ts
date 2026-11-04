import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import YAML from 'yaml';

import { peekActiveChangeKey } from '@/feature-evidence/stage-ledger.js';
import { removeAiAttributionComment } from '@/git-workflow/defaults.js';
import { changedOutside, readLastApplied, stampLastApplied } from '@/git-workflow/last-applied.js';
import { defaultFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';
import {
  FEATURE_DEVELOPMENT_VIEW_RELATIVE,
  featureDevelopmentViewPath,
  isGeneratedView,
} from '@/pipeline/feature-development-view.js';

import { PATHS } from './constants/paths.js';
import { checkoutIsNewer, FRAMEWORK_CONFIG_SPECS, parseDotConfig } from './framework-config.js';
import { parseTeamConfigText, renderTeamConfigFile, teamConfigPath } from './team-config.js';
import { isShippedWorkflowEntry } from './shipped-workflow-entries.js';
import {
  isNewerTeamFile,
  newerTeamFileLine,
  renderWriteBlock,
  TEAM_FILE_SCHEMA_VERSION,
} from './team-file-schema.js';
import { CONFIG_GROUP_FILES, isMigratedStub, MIGRATED_STUB_MARKER } from './team-config-legacy.js';
import { isRetiredSettingKey, retiredSettingLine } from './team-config-retired.js';
import { WORKFLOW_POLICY_STAGES } from './team-config-schema.js';
import {
  GIT_WORKFLOW_COMMITS_FILE,
  TEAM_CONFIG_FILES,
  toYamlValue,
  type TeamConfigFile,
} from './team-config-values.js';
import { versionAtLeast } from './version-compare.js';

declare const __PKG_VERSION__: string;

export const MIGRATION_DONE_LINE =
  'Moved your team settings to YAML files in .paqad/configs/. Review the changes and commit them together. Personal settings in .paqad/.config are unchanged.';
export const MIGRATE_ONCE_LINE =
  'Migrate once, on the main branch, and merge it there: teammates then pull the YAML files instead of migrating again.';
export const DRY_RUN_LINE =
  'This was a dry run, so nothing was written. Run paqad-ai config migrate to apply it.';
export const NEWER_CHECKOUT_LINE =
  "This project was last updated by a newer paqad, so its team settings weren't moved. Update paqad-ai, then run paqad-ai config migrate.";
export const NOTHING_TO_MOVE_LINE =
  'Nothing to move: your team settings are already in the YAML files in .paqad/configs/.';

const WORKFLOW_FILE: TeamConfigFile = 'feature-development/workflow.yaml';
const CHECKS_FILE: TeamConfigFile = 'feature-development/checks.yaml';
const LEGACY_ORDER = Object.values(CONFIG_GROUP_FILES).sort();

interface SetLine {
  key: string;
  value: string;
  comments: string[];
}

interface Carry {
  oldKey: string;
  file: TeamConfigFile;
  path: readonly string[];
  value: unknown;
  comments: string[];
  oldFile: string;
}

export interface TeamConfigMigration {
  ran: boolean;
  dryRun: boolean;
  lines: string[];
  created: string[];
  replaced: string[];
  deleted: string[];
  error?: string;
}

export interface MigrateTeamConfigOptions {
  dryRun?: boolean;
  version?: string;
  activeChange?: string | null;
}

const GENERATED_COMMENT = /\(env: [A-Z0-9_]+\)\s*$/u;
const SECTION_HEADER = /^#\s*──/u;
const COMMENTED_KEY = /^#\s*(?:export\s+)?[a-z][a-z0-9_]*\s*=/u;

function render(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
}

function at(data: unknown, path: readonly string[]): unknown {
  let node = data;
  for (const segment of path) {
    if (!isRecord(node)) return undefined;
    node = node[segment];
  }
  return node;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function readSetLines(text: string): SetLine[] {
  const out: SetLine[] = [];
  let pending: string[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === '') {
      pending = [];
      continue;
    }
    if (line.startsWith('#')) {
      if (GENERATED_COMMENT.test(line) || SECTION_HEADER.test(line) || COMMENTED_KEY.test(line)) {
        continue;
      }
      pending.push(line.replace(/^#\s?/u, ''));
      continue;
    }
    const parsed = [...parseDotConfig(line)];
    if (parsed.length === 1) {
      const [key, value] = parsed[0]!;
      out.push({ key, value, comments: pending });
    }
    pending = [];
  }
  return out;
}

function legacyPath(projectRoot: string, name: string): string {
  return join(projectRoot, PATHS.PROJECT_CONFIGS_DIR, name);
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function teamConfigMigrationNeeded(projectRoot: string): boolean {
  for (const name of LEGACY_ORDER) {
    const text = readText(legacyPath(projectRoot, name));
    if (text !== null && !isMigratedStub(text) && readSetLines(text).length > 0) return true;
  }
  const view = readText(featureDevelopmentViewPath(projectRoot));
  return view !== null && !isGeneratedView(view);
}

const HANDLED_WORKFLOW_PATHS = new Set([
  'schema_version',
  'merge_mode',
  'stages.checks.checks',
  'stages.checks.rule_compliance.mode',
  'stages.planning.escalation.attribution_pending',
  'stages.documentation_sync.strictness.require_canonical_sync',
  'stages.documentation_sync.escalation.stale_docs',
  'stages.checks.strictness.block_on_failure',
]);

function unusedWorkflowPaths(edited: unknown, defaults: unknown, prefix: string[] = []): string[] {
  const dotted = prefix.join('.');
  if (HANDLED_WORKFLOW_PATHS.has(dotted)) return [];
  if (
    prefix.length === 3 &&
    prefix[0] === 'stages' &&
    (prefix[2] === 'read' || prefix[2] === 'instructions')
  ) {
    return [];
  }
  if (isRecord(edited)) {
    return Object.entries(edited).flatMap(([key, value]) =>
      unusedWorkflowPaths(value, isRecord(defaults) ? defaults[key] : undefined, [...prefix, key]),
    );
  }
  return sameValue(edited, defaults) ? [] : [dotted];
}

interface WorkflowCarry {
  carries: Carry[];
  lines: string[];
  ruleCompliance?: string;
}

function planWorkflowCarry(edited: unknown, oldFile: string): WorkflowCarry {
  const defaults = defaultFeatureDevelopmentPolicy();
  const result: WorkflowCarry = { carries: [], lines: [] };
  const carry = (oldKey: string, file: TeamConfigFile, path: string[], value: unknown): void => {
    result.carries.push({ oldKey, file, path, value, comments: [], oldFile });
  };
  const stages = isRecord(edited) && isRecord(edited.stages) ? edited.stages : {};
  for (const stage of WORKFLOW_POLICY_STAGES) {
    const raw = isRecord(stages[stage]) ? stages[stage] : {};
    const own = defaults.stages[stage];
    const read = strings(raw.read).filter(
      (entry) => !own.read.includes(entry) && !isShippedWorkflowEntry(stage, 'read', entry),
    );
    if (read.length > 0) {
      carry(`stages.${stage}.read`, WORKFLOW_FILE, ['stages', stage, 'read'], read);
    }
    const instructions = strings(raw.instructions).filter(
      (entry) =>
        !own.instructions.includes(entry) && !isShippedWorkflowEntry(stage, 'instructions', entry),
    );
    if (instructions.length > 0) {
      carry(
        `stages.${stage}.instructions`,
        WORKFLOW_FILE,
        ['stages', stage, 'instructions'],
        instructions,
      );
      for (const instruction of instructions) {
        result.lines.push(
          `Carried this ${stage} instruction from the old workflow file; delete it from ${WORKFLOW_FILE} if it is a stale copy of paqad's own: ${instruction}`,
        );
      }
    }
  }
  const planning = isRecord(stages.planning) ? stages.planning : {};
  const attribution = at(planning, ['escalation', 'attribution_pending']);
  if (
    (attribution === 'defer' || attribution === 'stop') &&
    attribution !== defaults.stages.planning.escalation.attribution_pending
  ) {
    carry(
      'stages.planning.escalation.attribution_pending',
      WORKFLOW_FILE,
      ['stages', 'planning', 'module_attribution'],
      attribution,
    );
  }
  const docs = isRecord(stages.documentation_sync) ? stages.documentation_sync : {};
  const staleEscalation = at(docs, ['escalation', 'stale_docs']);
  const requireSync = at(docs, ['strictness', 'require_canonical_sync']);
  if (requireSync === false || staleEscalation === 'warn') {
    result.lines.push(retiredSettingLine(oldFile, 'stages.documentation_sync.stale_docs'));
  }
  const checksStage = isRecord(stages.checks) ? stages.checks : {};
  const checks = isRecord(checksStage.checks) ? checksStage.checks : {};
  const base = defaults.stages.checks.checks!;
  if (checks.use_project_profile_commands !== undefined || checks.commands !== undefined) {
    const names =
      checks.use_project_profile_commands === false
        ? []
        : [...new Set([...base.commands, ...strings(checks.commands)])];
    if (names.join(',') !== base.commands.join(',')) {
      carry(
        checks.use_project_profile_commands === false
          ? 'stages.checks.checks.use_project_profile_commands'
          : 'stages.checks.checks.commands',
        CHECKS_FILE,
        ['commands', 'from_project_profile'],
        names,
      );
    }
  }
  strings(checks.shell_commands).forEach((command, index) => {
    carry(
      'stages.checks.checks.shell_commands',
      CHECKS_FILE,
      ['commands', 'extra', `command-${index + 1}`],
      command,
    );
  });
  const blockOnFailure =
    typeof checks.block_on_failure === 'boolean'
      ? checks.block_on_failure
      : at(checksStage, ['strictness', 'block_on_failure']);
  if (typeof blockOnFailure === 'boolean' && blockOnFailure !== base.block_on_failure) {
    carry(
      typeof checks.block_on_failure === 'boolean'
        ? 'stages.checks.checks.block_on_failure'
        : 'stages.checks.strictness.block_on_failure',
      CHECKS_FILE,
      ['on_failure'],
      blockOnFailure ? 'block' : 'warn',
    );
  }
  const mode = at(checksStage, ['rule_compliance', 'mode']);
  if (typeof mode === 'string' && ['off', 'warn', 'strict'].includes(mode)) {
    result.ruleCompliance = mode;
  }
  for (const path of unusedWorkflowPaths(edited, defaults)) {
    result.lines.push(
      `${path} was set in the old workflow file but paqad never used it, so it wasn't carried over.`,
    );
  }
  return result;
}

function pairFor(document: YAML.Document, path: readonly string[]): YAML.Pair | undefined {
  const parent =
    path.length === 1 ? document.contents : document.getIn(path.slice(0, -1) as string[], true);
  if (!YAML.isMap(parent)) return undefined;
  const last = path[path.length - 1];
  return parent.items.find((pair) => {
    const key = YAML.isScalar(pair.key) ? pair.key.value : pair.key;
    return key === last;
  });
}

function setWithComments(
  document: YAML.Document,
  path: readonly string[],
  value: unknown,
  comments: string[],
): void {
  document.setIn([...path], value);
  if (comments.length === 0) return;
  const pair = pairFor(document, path);
  if (pair === undefined) return;
  if (!YAML.isScalar(pair.key)) pair.key = document.createNode(pair.key);
  (pair.key as YAML.Scalar).commentBefore = comments.map((line) => ` ${line}`).join('\n');
}

function stubText(version: string, teamMinimum: string | undefined, unknown: SetLine[]): string {
  const minimum =
    teamMinimum !== undefined &&
    /^\d+\.\d+\.\d+/u.test(teamMinimum) &&
    !versionAtLeast(version, teamMinimum)
      ? teamMinimum
      : version;
  return [
    MIGRATED_STUB_MARKER,
    "# This project's paqad settings moved to the YAML files in this folder.",
    "# The lines below are for an older paqad, which can't read the YAML files: it turns itself off",
    '# instead of running on its defaults. A current paqad ignores this file.',
    'paqad_enable=false',
    `minimum_version=${minimum}`,
    ...(unknown.length === 0 ? [] : ['# Not carried over (not paqad settings):']),
    ...unknown.map((line) => `# ${line.key}=${line.value}`),
    '',
  ].join('\n');
}

function commitsText(document: YAML.Document): string {
  const text = document.toString({ lineWidth: 0 });
  return document.has('ai_attribution') ? removeAiAttributionComment(text) : text;
}

function commitsStampIsTrusted(projectRoot: string): boolean {
  return (
    readLastApplied(projectRoot) !== null && !changedOutside(projectRoot).includes('commits.yaml')
  );
}

function isTracked(projectRoot: string, relativePath: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function untrack(projectRoot: string, relativePath: string): void {
  try {
    execFileSync('git', ['rm', '--cached', '-q', '-f', '--', relativePath], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
  } catch {}
}

export function migrateTeamConfig(
  projectRoot: string,
  options: MigrateTeamConfigOptions = {},
): TeamConfigMigration {
  const dryRun = options.dryRun === true;
  const version = options.version ?? __PKG_VERSION__;
  const result: TeamConfigMigration = {
    ran: false,
    dryRun,
    lines: [],
    created: [],
    replaced: [],
    deleted: [],
  };
  if (!teamConfigMigrationNeeded(projectRoot)) {
    result.lines.push(NOTHING_TO_MOVE_LINE);
    return result;
  }
  if (checkoutIsNewer(projectRoot, version)) {
    result.lines.push(NEWER_CHECKOUT_LINE);
    return result;
  }
  result.ran = true;
  const rel = (path: string): string => relative(projectRoot, path).split('\\').join('/');

  const legacy: Array<{ name: string; path: string; lines: SetLine[] }> = [];
  for (const name of LEGACY_ORDER) {
    const path = legacyPath(projectRoot, name);
    const text = readText(path);
    if (text === null || isMigratedStub(text)) continue;
    legacy.push({ name, path, lines: readSetLines(text) });
  }

  const winners = new Map<string, { line: SetLine; file: string }>();
  const seenIn = new Map<string, string[]>();
  for (const file of legacy) {
    for (const line of file.lines) {
      winners.set(line.key, { line, file: file.name });
      seenIn.set(line.key, [...(seenIn.get(line.key) ?? []), file.name]);
    }
  }
  for (const [key, files] of seenIn) {
    const unique = [...new Set(files)];
    if (unique.length < 2) continue;
    const kept = winners.get(key)!;
    result.lines.push(
      `${key} was set in ${unique[unique.length - 2]} and ${unique[unique.length - 1]}; kept ${kept.line.value} from ${unique[unique.length - 1]}.`,
    );
  }

  const carries: Carry[] = [];
  const unknown: SetLine[] = [];
  for (const [key, { line, file }] of winners) {
    const spec = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === key);
    if (isRetiredSettingKey(key)) {
      result.lines.push(retiredSettingLine(`${PATHS.PROJECT_CONFIGS_DIR}/${file}`, key));
      continue;
    }
    if (spec === undefined) {
      unknown.push(line);
      result.lines.push(
        `${key}=${line.value} in ${file} isn't a paqad setting, so it wasn't carried over.`,
      );
      continue;
    }
    carries.push({
      oldKey: key,
      file: spec.file,
      path: spec.path,
      value: toYamlValue(spec, line.value),
      comments: line.comments,
      oldFile: file,
    });
  }

  const viewPath = featureDevelopmentViewPath(projectRoot);
  const viewText = readText(viewPath);
  const legacyWorkflow = viewText !== null && !isGeneratedView(viewText) ? viewText : null;
  let workflowReadable = true;
  if (legacyWorkflow !== null) {
    let edited: unknown;
    try {
      edited = YAML.parse(legacyWorkflow);
    } catch (error) {
      workflowReadable = false;
      result.lines.push(
        `Couldn't read ${FEATURE_DEVELOPMENT_VIEW_RELATIVE}, so it was kept and none of its settings were carried over: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      );
    }
    if (workflowReadable) {
      const workflow = planWorkflowCarry(edited, FEATURE_DEVELOPMENT_VIEW_RELATIVE);
      result.lines.push(...workflow.lines);
      for (const carry of workflow.carries) {
        const same = carries.findIndex(
          (entry) => entry.file === carry.file && entry.path.join('.') === carry.path.join('.'),
        );
        if (same === -1) carries.push(carry);
      }
      if (workflow.ruleCompliance !== undefined) {
        const spec = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === 'rule_compliance')!;
        const existing = carries.findIndex((entry) => entry.oldKey === 'rule_compliance');
        if (existing !== -1) {
          result.lines.push(
            `rule_compliance was also set in the workflow file; kept ${workflow.ruleCompliance} from there.`,
          );
          carries.splice(existing, 1);
        }
        carries.push({
          oldKey: 'stages.checks.rule_compliance.mode',
          file: spec.file,
          path: spec.path,
          value: toYamlValue(spec, workflow.ruleCompliance),
          comments: [],
          oldFile: FEATURE_DEVELOPMENT_VIEW_RELATIVE,
        });
      }
    }
  }

  const documents = new Map<TeamConfigFile, { document: YAML.Document; existed: boolean }>();
  const documentFor = (file: TeamConfigFile): YAML.Document => {
    const known = documents.get(file);
    if (known !== undefined) return known.document;
    const existing = readText(teamConfigPath(projectRoot, file));
    const parsed =
      existing === null
        ? {
            document: YAML.parseDocument(`schema_version: ${TEAM_FILE_SCHEMA_VERSION}\n`),
            error: undefined,
          }
        : parseTeamConfigText(file, existing);
    const document = parsed.document;
    if (document === null || parsed.error !== undefined) {
      throw new Error(
        `${file} isn't valid YAML, so the settings for it weren't moved: ${parsed.error}`,
      );
    }
    if (document.contents !== null && !YAML.isMap(document.contents)) {
      throw new Error(
        `${file} holds a list or a single value instead of settings, so the settings for it weren't moved.`,
      );
    }
    documents.set(file, { document, existed: existing !== null });
    return document;
  };

  const summary: string[] = [];
  try {
    for (const carry of carries) {
      const document = documentFor(carry.file);
      const current: unknown = document.getIn([...carry.path]);
      const plain = YAML.isNode(current) ? current.toJSON() : current;
      if (plain !== undefined && plain !== null) {
        if (!sameValue(plain, carry.value)) {
          result.lines.push(
            `${carry.oldKey} is set in both ${carry.oldFile} and ${carry.file}; kept the YAML value ${render(plain)}.`,
          );
        }
        continue;
      }
      setWithComments(document, carry.path, carry.value, carry.comments);
      summary.push(
        `${carry.oldKey} → ${carry.file}: ${carry.path.join('.')} = ${render(carry.value)}`,
      );
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.lines.push(result.error);
    return result;
  }
  result.lines.push(...summary);

  const active =
    options.activeChange === undefined ? peekActiveChangeKey(projectRoot) : options.activeChange;
  if (active !== null) {
    result.lines.push(
      `The change ${active} is part-way through its stages. Its settings moved now, so its remaining stages read the YAML files.`,
    );
  }

  const blockedLines = [...documents.keys()].flatMap((file) => {
    const text = readText(teamConfigPath(projectRoot, file)) ?? '';
    const shown = `${PATHS.PROJECT_CONFIGS_DIR}/${file}`;
    if (file === GIT_WORKFLOW_COMMITS_FILE) {
      return isNewerTeamFile(text) ? [newerTeamFileLine(shown)] : [];
    }
    const blocked = renderWriteBlock(text, shown);
    return blocked === null ? [] : [blocked];
  });
  if (blockedLines.length > 0) {
    const lines = blockedLines;
    result.lines = lines;
    result.error = lines.join(' ');
    return result;
  }

  const teamMinimum = winners.get('minimum_version')?.line.value;
  const stub = stubText(version, teamMinimum, unknown);
  const stubPath = legacyPath(projectRoot, CONFIG_GROUP_FILES.app);

  const writes: Array<{ path: string; text: string; existed: boolean }> = [];
  for (const [file, { document, existed }] of documents) {
    writes.push({
      path: teamConfigPath(projectRoot, file),
      text:
        file === GIT_WORKFLOW_COMMITS_FILE
          ? commitsText(document)
          : renderTeamConfigFile(file, document),
      existed,
    });
  }
  for (const file of TEAM_CONFIG_FILES) {
    const path = teamConfigPath(projectRoot, file);
    if (documents.has(file) || existsSync(path)) continue;
    writes.push({ path, text: renderTeamConfigFile(file, null), existed: false });
  }
  const stubWrite = { path: stubPath, text: stub, existed: existsSync(stubPath) };

  for (const write of [...writes, stubWrite]) {
    (write.existed ? result.replaced : result.created).push(rel(write.path));
  }
  const deleteView = legacyWorkflow !== null && workflowReadable;
  const toDelete = legacy
    .filter((file) => file.name !== CONFIG_GROUP_FILES.app)
    .map((file) => file.path);
  result.deleted.push(...toDelete.map(rel));
  if (deleteView) result.deleted.push(FEATURE_DEVELOPMENT_VIEW_RELATIVE);

  if (!dryRun) {
    const stampCommits =
      documents.has(GIT_WORKFLOW_COMMITS_FILE) && commitsStampIsTrusted(projectRoot);
    try {
      for (const write of writes) {
        mkdirSync(dirname(write.path), { recursive: true });
        writeFileSync(write.path, write.text, 'utf8');
      }
      if (deleteView) {
        const tracked = isTracked(projectRoot, FEATURE_DEVELOPMENT_VIEW_RELATIVE);
        rmSync(viewPath, { force: true });
        if (tracked) untrack(projectRoot, FEATURE_DEVELOPMENT_VIEW_RELATIVE);
      }
      writeFileSync(stubWrite.path, stubWrite.text, 'utf8');
    } catch (error) {
      result.error = `Couldn't write the new settings files, so the old ones were kept: ${error instanceof Error ? error.message : String(error)}`;
      result.lines.push(result.error);
      return result;
    }
    for (const path of toDelete) rmSync(path, { force: true });
    if (stampCommits) stampLastApplied(projectRoot, ['commits.yaml'], { version });
  }

  for (const path of result.created) result.lines.push(`Created ${path}`);
  for (const path of result.replaced) result.lines.push(`Replaced ${path}`);
  for (const path of result.deleted) result.lines.push(`Deleted ${path}`);
  result.lines.push(MIGRATE_ONCE_LINE);
  result.lines.push(dryRun ? DRY_RUN_LINE : MIGRATION_DONE_LINE);
  return result;
}
