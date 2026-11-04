import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { hasPath, readPath, removeKey } from '@/git-workflow/yaml-edit.js';
import { LEGACY_SCHEMA_LINE_PREFIX } from '@/update/legacy-schema-line.js';

import { PATHS } from './constants/paths.js';
import { readTextIfExistsSync } from './fs/read-if-exists.js';
import { isNewerTeamFile, newerTeamFileLine, swapTeamFileStamp } from './team-file-schema.js';

export const RETIRED_SAFETY_FILE = 'feature-development/safety.yaml';
const WORKFLOW_FILE = 'feature-development/workflow.yaml';
const STAMP_LINE = /^(?:schema_version|paqad_version)[ \t]*:/u;

export interface RetiredTeamSetting {
  key: string;
  file: string;
  path: readonly string[];
  note: string;
  value: string;
}

export const RETIRED_TEAM_SETTINGS: readonly RetiredTeamSetting[] = [
  {
    key: 'research_depth',
    file: 'models.yaml',
    path: ['research', 'depth'],
    note: 'How far planning research looks, from the newest options to proven ones.',
    value: 'standard',
  },
  {
    key: 'full_lane_default',
    file: WORKFLOW_FILE,
    path: ['lanes', 'default'],
    note: 'Sends every change through the full lane, the most thorough one.',
    value: 'auto',
  },
  {
    key: 'require_adversarial_review',
    file: WORKFLOW_FILE,
    path: ['stages', 'review', 'adversarial_pass'],
    note: 'Requires an adversarial review pass before a change is delivered.',
    value: 'required',
  },
  {
    key: 'block_on_stale_docs',
    file: WORKFLOW_FILE,
    path: ['stages', 'documentation_sync', 'stale_docs'],
    note: 'Blocks delivery while the project docs are out of date.',
    value: 'block',
  },
  {
    key: 'decisions_max_screens_per_task',
    file: 'decisions.yaml',
    path: ['max_screens_per_change'],
    note: 'The most decision screens paqad shows for one change.',
    value: '3',
  },
  {
    key: 'decisions_idle_timeout_minutes',
    file: 'decisions.yaml',
    path: ['auto_resolve_after_minutes'],
    note: 'Minutes a pending decision waits for an answer before paqad settles it itself.',
    value: '30',
  },
  {
    key: 'require_db_review_for_migrations',
    file: RETIRED_SAFETY_FILE,
    path: ['database_review_for_migrations'],
    note: 'Requires a database review when a change includes migrations.',
    value: 'required',
  },
  {
    key: 'escalate_destructive_operations',
    file: RETIRED_SAFETY_FILE,
    path: ['destructive_operations'],
    note: 'Whether paqad blocks, asks you about or warns on a destructive operation.',
    value: 'block',
  },
  {
    key: 'escalate_risky_migrations',
    file: RETIRED_SAFETY_FILE,
    path: ['risky_migrations'],
    note: 'Whether paqad blocks, asks you about or warns on a risky migration.',
    value: 'warn',
  },
  {
    key: 'escalate_security_findings',
    file: RETIRED_SAFETY_FILE,
    path: ['security_findings'],
    note: 'Whether paqad blocks, asks you about or warns on a security finding.',
    value: 'block',
  },
  {
    key: 'escalate_db_row_threshold',
    file: RETIRED_SAFETY_FILE,
    path: ['large_data_change_rows'],
    note: 'A data change that touches more rows than this is treated as risky.',
    value: '10000',
  },
];

const RETIRED_KEYS: ReadonlySet<string> = new Set(RETIRED_TEAM_SETTINGS.map((row) => row.key));

export function isRetiredSettingKey(key: string): boolean {
  return RETIRED_KEYS.has(key);
}

export function retiredPathsFor(file: string): string[] {
  return RETIRED_TEAM_SETTINGS.filter((row) => row.file === file).map((row) => row.path.join('.'));
}

export function retiredSettingLine(file: string, path: string): string {
  return `${file}: removed ${path}, which paqad doesn't read any more.`;
}

function withoutLiveSetting(text: string, setting: RetiredTeamSetting): string {
  let next = removeKey(text, setting.path);
  for (let depth = setting.path.length - 1; depth > 0; depth -= 1) {
    const parent = setting.path.slice(0, depth);
    const value = readPath(next, parent);
    const empty =
      value === null ||
      (typeof value === 'object' && Object.keys(value as Record<string, unknown>).length === 0);
    if (!empty) break;
    next = removeKey(next, parent);
  }
  return next;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function bodyOf(line: string): string {
  return line.replace(/\r?\n$/u, '');
}

function commentColumn(line: string): number | null {
  const match = /^(\s*)#(\s*)\S/u.exec(bodyOf(line));
  return match === null ? null : match[1]!.length + 1 + match[2]!.length;
}

function isEmptyCommentedGroup(lines: readonly string[], index: number, key: string): boolean {
  const header = new RegExp(`^\\s*#\\s*${escapeRegExp(key)}:\\s*$`, 'u');
  if (!header.test(bodyOf(lines[index] ?? ''))) return false;
  const column = commentColumn(lines[index]!)!;
  const next = lines[index + 1];
  if (next === undefined || bodyOf(next).trim() === '') return true;
  const nextColumn = commentColumn(next);
  if (nextColumn !== null) return nextColumn <= column;
  return bodyOf(next).search(/\S/u) <= column;
}

function withoutCommentedCopy(text: string, setting: RetiredTeamSetting): string {
  const leaf = setting.path[setting.path.length - 1]!;
  const copy = new RegExp(
    `^\\s*#\\s*${escapeRegExp(leaf)}:\\s*${escapeRegExp(setting.value)}\\s*$`,
    'u',
  );
  const note = new RegExp(`^\\s*#\\s*(?:#\\s*)?${escapeRegExp(setting.note)}\\s*$`, 'u');
  const lines = text.split(/(?<=\n)/u);
  const at = lines.findIndex((line) => copy.test(bodyOf(line)));
  if (at < 0) return text;
  lines.splice(at, 1);
  let above = at - 1;
  if (above >= 0 && note.test(bodyOf(lines[above]!))) {
    lines.splice(above, 1);
    above -= 1;
  }
  for (let depth = setting.path.length - 2; depth >= 0 && above >= 0; depth -= 1) {
    if (!isEmptyCommentedGroup(lines, above, setting.path[depth]!)) break;
    lines.splice(above, 1);
    above -= 1;
  }
  return lines.join('');
}

export function removeRetiredSettings(
  file: string,
  text: string,
  shownFile: string,
  notes: string[],
): string {
  let next = text;
  for (const setting of RETIRED_TEAM_SETTINGS) {
    if (setting.file !== file) continue;
    next = withoutCommentedCopy(next, setting);
    if (YAML.parseDocument(next).errors.length > 0 || !hasPath(next, setting.path)) continue;
    next = withoutLiveSetting(next, setting);
    notes.push(retiredSettingLine(shownFile, setting.path.join('.')));
  }
  return next;
}

function holdsOnlyPaqadLines(text: string, ownLines: ReadonlySet<string>): boolean {
  return text.split(/\r?\n/u).every((line) => {
    const trimmed = line.trim();
    return (
      trimmed === '' ||
      STAMP_LINE.test(line) ||
      ownLines.has(trimmed) ||
      trimmed.startsWith(LEGACY_SCHEMA_LINE_PREFIX)
    );
  });
}

export function settleRetiredSafetyFile(
  projectRoot: string,
  ownLines: ReadonlySet<string>,
  notes: string[],
): void {
  const shown = `${PATHS.PROJECT_CONFIGS_DIR}/${RETIRED_SAFETY_FILE}`;
  const path = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR, RETIRED_SAFETY_FILE);
  const text = readTextIfExistsSync(path);
  if (text === null) return;
  if (isNewerTeamFile(text)) {
    notes.push(newerTeamFileLine(shown));
    return;
  }
  const lines: string[] = [];
  const next = removeRetiredSettings(RETIRED_SAFETY_FILE, swapTeamFileStamp(text), shown, lines);
  try {
    if (holdsOnlyPaqadLines(next, ownLines)) {
      rmSync(path);
      notes.push(...lines, `Removed ${shown}, which paqad doesn't read any more.`);
      return;
    }
    if (next === text) return;
    writeFileSync(path, next, 'utf8');
    notes.push(
      ...lines,
      `${shown} holds notes your team wrote, so it stayed. paqad doesn't read it any more.`,
    );
  } catch (error) {
    notes.push(
      `Couldn't change ${shown}: ${error instanceof Error ? error.message : 'unknown error'}. The next update tries again.`,
    );
  }
}
