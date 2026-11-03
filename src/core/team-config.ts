import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { stampLastApplied } from '@/git-workflow/last-applied.js';

import { PATHS } from './constants/paths.js';
import {
  checkoutIsNewer,
  FRAMEWORK_CONFIG_SPECS,
  type FrameworkConfigSpec,
} from './framework-config.js';
import { readTextIfExistsSync } from './fs/read-if-exists.js';
import { versionAtLeast } from './version-compare.js';
import { STRUCTURED_TEAM_SETTINGS, writeTeamConfigSchemas } from './team-config-schema.js';
import {
  legacyBothLine,
  legacyStillLine,
  legacyTeamConfigReadable,
  readLegacyTeamConfig,
  type LegacyCollision,
} from './team-config-legacy.js';
import {
  checkYamlValue,
  fromYamlValue,
  GIT_WORKFLOW_COMMITS_FILE,
  TEAM_CONFIG_FILE_DESCRIPTIONS,
  TEAM_CONFIG_FILES,
  toYamlValue,
  yamlDefault,
  type OwnTeamConfigFile,
  type TeamConfigFile,
} from './team-config-values.js';

declare const __PKG_VERSION__: string;

export const TEAM_CONFIG_READ_FILES: readonly TeamConfigFile[] = [
  ...TEAM_CONFIG_FILES,
  GIT_WORKFLOW_COMMITS_FILE,
];

export interface TeamConfigIssue {
  file: TeamConfigFile | string;
  kind?: 'invalid' | 'legacy' | 'repaired';
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

export function notSettingsMapMessage(file: TeamConfigFile): string {
  return `${file} holds a list or a single value instead of settings, so none of its settings are used.`;
}

function isOwnTeamConfigFile(file: TeamConfigFile): file is OwnTeamConfigFile {
  return (TEAM_CONFIG_FILES as readonly string[]).includes(file);
}

function holdsSettings(document: YAML.Document): boolean {
  return document.contents === null || YAML.isMap(document.contents);
}

export function parseTeamConfigText(
  file: TeamConfigFile,
  text: string,
): { document: YAML.Document | null; error?: string; repairs: TeamConfigRepair[] } {
  const repaired = isOwnTeamConfigFile(file)
    ? repairTeamConfigText(file, text)
    : { text, repairs: [] };
  const document = YAML.parseDocument(repaired.text);
  if (document.errors.length > 0) {
    return {
      document: null,
      error: document.errors[0]!.message.split('\n')[0]!,
      repairs: repaired.repairs,
    };
  }
  return { document, repairs: repaired.repairs };
}

export function readTeamYamlFile(
  projectRoot: string,
  file: TeamConfigFile,
): { document: YAML.Document | null; error?: string; repairs: TeamConfigRepair[] } {
  const path = teamConfigPath(projectRoot, file);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { document: null, repairs: [] };
  }
  return parseTeamConfigText(file, text);
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
    const { document, error, repairs } = readTeamYamlFile(projectRoot, file);
    if (error !== undefined) {
      issues.push({ file, kind: 'invalid', message: invalidFileMessage(file, error) });
      continue;
    }
    if (document === null) continue;
    if (!holdsSettings(document)) {
      issues.push({ file, kind: 'invalid', message: notSettingsMapMessage(file) });
      continue;
    }
    for (const repair of repairs) issues.push({ file, kind: 'repaired', message: repair.message });
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
  if (!legacyTeamConfigReadable()) return { merged, collisions: [], sources, issues };
  const legacy = readLegacyTeamConfig(projectRoot);
  for (const [key, value] of legacy.merged) {
    const source = legacy.sources.get(key)!;
    const oldFile = source.split(/[\\/]/u).pop()!;
    if (claimed.has(key)) {
      const spec = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === key)!;
      issues.push({
        file: oldFile,
        key,
        kind: 'legacy',
        message: legacyBothLine(key, oldFile, spec.file),
      });
      continue;
    }
    merged.set(key, value);
    sources.set(key, source);
    issues.push({ file: oldFile, key, kind: 'legacy', message: legacyStillLine(key, oldFile) });
  }
  return { merged, collisions: legacy.collisions, sources, issues };
}

function setLiveValue(document: YAML.Document, path: readonly string[], value: unknown): void {
  if (!YAML.isMap(document.contents)) document.contents = new YAML.YAMLMap();
  let map = document.contents as YAML.YAMLMap;
  for (const segment of path.slice(0, -1)) {
    const next: unknown = map.get(segment, true);
    if (YAML.isMap(next)) {
      map = next;
      continue;
    }
    const created = new YAML.YAMLMap();
    map.set(segment, created);
    map = created;
  }
  map.set(path[path.length - 1], document.createNode(value));
}

export function writeTeamYamlValue(
  projectRoot: string,
  file: TeamConfigFile,
  path: readonly string[],
  value: unknown,
): string {
  const target = teamConfigPath(projectRoot, file);
  const existing = readTextIfExistsSync(target);
  mkdirSync(dirname(target), { recursive: true });
  if (!isOwnTeamConfigFile(file)) {
    const document = YAML.parseDocument(existing ?? '');
    if (document.errors.length > 0) {
      throw new Error(invalidFileMessage(file, document.errors[0]!.message));
    }
    document.setIn([...path], value);
    writeFileSync(target, document.toString({ lineWidth: 0 }), 'utf8');
    stampLastApplied(projectRoot, ['commits.yaml']);
    return target;
  }
  const { document, error } =
    existing === null
      ? { document: new YAML.Document(), error: undefined }
      : parseTeamConfigText(file, existing);
  if (error !== undefined || document === null) {
    throw new Error(invalidFileMessage(file, error ?? ''));
  }
  if (!holdsSettings(document)) throw new Error(notSettingsMapMessage(file));
  setLiveValue(document, path, value);
  writeFileSync(target, renderTeamConfigFile(file, document), 'utf8');
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
    mkdirSync(dirname(path), { recursive: true });
    try {
      writeFileSync(path, renderTeamConfigFile(file, null), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    created.push(path);
  }
  return created;
}

function writtenVersion(document: YAML.Document): string | undefined {
  if (!YAML.isMap(document.contents)) return undefined;
  const version: unknown = document.get('paqad_version');
  return typeof version === 'string' && /^\d+\.\d+\.\d+/u.test(version) ? version : undefined;
}

export function syncTeamConfigFiles(
  projectRoot: string,
  problems: string[] = [],
  version: string = __PKG_VERSION__,
): string[] {
  if (checkoutIsNewer(projectRoot, version)) return [];
  writeTeamConfigSchemas(projectRoot);
  const written = ensureTeamConfigFiles(projectRoot);
  for (const file of TEAM_CONFIG_FILES) {
    const path = teamConfigPath(projectRoot, file);
    if (written.includes(path)) continue;
    const text = readTextIfExistsSync(path);
    if (text === null) continue;
    const { document, error } = parseTeamConfigText(file, text);
    if (error !== undefined || document === null) {
      problems.push(invalidFileMessage(file, error ?? ''));
      continue;
    }
    if (!holdsSettings(document)) {
      problems.push(notSettingsMapMessage(file));
      continue;
    }
    const stamped = writtenVersion(document);
    if (stamped !== undefined && !versionAtLeast(version, stamped)) continue;
    if (renderTeamConfigFile(file, document, stamped ?? version) === text) continue;
    writeFileSync(path, renderTeamConfigFile(file, document, version), 'utf8');
    written.push(path);
  }
  return written;
}

export const TEAM_CONFIG_HEADER_LINES = [
  "# Every setting is listed with paqad's default. To change one, remove the # in front of it.",
  "# A setting left commented out uses paqad's default, which can improve in a later version.",
  '# Inside a group, also remove the # in front of the group name, such as updates:. paqad-ai update does this for you.',
] as const;
const OLD_HEADER_LINES = [
  "# Only settings this team changed live here; everything else uses paqad's default.",
  '# See every setting, its value and where it comes from: paqad-ai config show',
];
export const NOT_A_SETTING_LINE = '# Not a paqad setting, so paqad ignores it (kept as written):';
export const TEAM_NOTES_LINE = '# Notes the team wrote, kept as written:';
const NOT_SET_BY_DEFAULT = ' Not set by default.';

interface TeamSetting {
  path: readonly string[];
  note: string;
  value: unknown;
  list: boolean;
}

interface SettingNode {
  key: string;
  path: string[];
  children: Map<string, SettingNode>;
  setting?: TeamSetting;
}

function teamFileSettings(file: OwnTeamConfigFile): TeamSetting[] {
  const settings: TeamSetting[] = [];
  for (const spec of FRAMEWORK_CONFIG_SPECS) {
    if (spec.file !== file) continue;
    settings.push({
      path: spec.path,
      note: spec.comment,
      value: yamlDefault(spec),
      list: spec.yaml?.list === true,
    });
  }
  for (const setting of STRUCTURED_TEAM_SETTINGS) {
    if (setting.file !== file) continue;
    settings.push({
      path: setting.path,
      note: typeof setting.schema.description === 'string' ? setting.schema.description : '',
      value: setting.schema.default,
      list: setting.schema.type === 'array',
    });
  }
  return settings;
}

function settingsTree(file: OwnTeamConfigFile): SettingNode {
  const root: SettingNode = { key: '', path: [], children: new Map() };
  for (const setting of teamFileSettings(file)) {
    let node = root;
    for (const segment of setting.path) {
      let child = node.children.get(segment);
      if (child === undefined) {
        child = { key: segment, path: [...node.path, segment], children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
    node.setting = setting;
  }
  return root;
}

function settingNote(setting: TeamSetting): string {
  return setting.value === undefined && !setting.list
    ? `${setting.note}${NOT_SET_BY_DEFAULT}`
    : setting.note;
}

function inlineYaml(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    const document = new YAML.Document(value);
    if (YAML.isCollection(document.contents)) document.contents.flow = true;
    return document.toString({ lineWidth: 0 }).trimEnd();
  }
  return YAML.stringify(value, { lineWidth: 0 }).trimEnd();
}

function defaultText(setting: TeamSetting): string {
  if (setting.value !== undefined) return ` ${inlineYaml(setting.value)}`;
  return setting.list ? ' []' : '';
}

function commentAt(line: string, column: number | null): string {
  return column === null ? line : `${line.slice(0, column)}# ${line.slice(column)}`;
}

function stripNodeComments(node: YAML.Node): YAML.Node {
  const copy = node.clone() as YAML.Node;
  const clear = (target: YAML.Node): void => {
    const inline =
      (YAML.isScalar(target) || (YAML.isCollection(target) && target.flow === true)) &&
      typeof target.comment === 'string'
        ? target.comment.split('\n')[0]!
        : '';
    target.commentBefore = null;
    target.comment = inline.trim() === '' ? null : inline;
    target.spaceBefore = false;
  };
  clear(copy);
  YAML.visit(copy, {
    Node: (_key, target) => clear(target),
    Pair: (_key, pair) => {
      if (YAML.isNode(pair.key)) clear(pair.key);
    },
  });
  return copy;
}

function yamlLines(map: YAML.YAMLMap, indent: string): string[] {
  const document = new YAML.Document();
  document.contents = map;
  return document
    .toString({ lineWidth: 0 })
    .trimEnd()
    .split('\n')
    .map((line) => `${indent}${line}`);
}

function liveValueLines(key: string, node: unknown, indent: string): string[] {
  const map = new YAML.YAMLMap();
  const value = YAML.isNode(node) ? stripNodeComments(node) : node;
  map.items.push(new YAML.Pair(new YAML.Scalar(key), value));
  return yamlLines(map, indent);
}

const KEY_LINE = /^(\s*)(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_][A-Za-z0-9_.-]*))\s*:(?:\s|$)/u;
const BLOCK_SCALAR = /:\s*[|>][-+0-9]*\s*(?:#.*)?$|^\s*-\s+[|>][-+0-9]*\s*(?:#.*)?$/u;
const SETTING_SHAPE = /^([a-z0-9_]+):(\s.*)?$/u;
const SEQUENCE_MARK = '\u0000seq';

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function unwrapComment(body: string): string {
  let text = body.trim();
  while (text.startsWith('#')) text = text.slice(1).trim();
  return text;
}

interface CommentBlock {
  bodies: string[];
  path?: string;
}

interface ScannedComments {
  rendered: boolean;
  blocks: CommentBlock[];
  notes: string[];
}

function scanComments(text: string): ScannedComments {
  const blocks: CommentBlock[] = [];
  const notes: string[] = [];
  let rendered = false;
  let inNotes = false;
  let pending: string[] = [];
  const stack: Array<{ column: number; key: string }> = [];
  let blockColumn = -1;
  const flush = (path?: string): void => {
    if (pending.length > 0)
      blocks.push(path === undefined ? { bodies: pending } : { bodies: pending, path });
    pending = [];
  };
  for (const line of text.split('\n')) {
    if (blockColumn >= 0) {
      if (line.trim() === '' || indentOf(line) > blockColumn) continue;
      blockColumn = -1;
    }
    const trimmed = line.trim();
    if (trimmed === '') {
      flush();
      continue;
    }
    if (trimmed.startsWith('#')) {
      if (trimmed === TEAM_CONFIG_HEADER_LINES[0]) rendered = true;
      if (trimmed === TEAM_NOTES_LINE) {
        flush();
        inNotes = true;
        continue;
      }
      const body = line.trimStart().slice(1);
      if (inNotes) notes.push(body);
      else pending.push(body);
      continue;
    }
    const column = indentOf(line);
    while (stack.length > 0 && stack[stack.length - 1]!.column >= column) stack.pop();
    const match = KEY_LINE.exec(line);
    if (match === null) {
      flush();
      if (trimmed.startsWith('-')) stack.push({ column, key: SEQUENCE_MARK });
      if (BLOCK_SCALAR.test(line)) blockColumn = column;
      continue;
    }
    const key = match[2] ?? match[3] ?? match[4]!;
    stack.push({ column, key });
    flush(stack.map((frame) => frame.key).join('\u0001'));
    if (BLOCK_SCALAR.test(line)) blockColumn = column;
  }
  flush();
  return { rendered, blocks, notes };
}

interface RenderContext {
  file: OwnTeamConfigFile;
  data: unknown;
  document: YAML.Document | null;
  tree: SettingNode;
  scanned: ScannedComments;
  ownLines: Set<string>;
  notes: Set<string>;
  keys: Set<string>;
  groupKeys: Set<string>;
  leafKeys: Set<string>;
  used: Set<string>;
  anchors: Map<string, Array<readonly string[]>>;
}

function pathKey(path: readonly string[]): string {
  return path.join('\u0001');
}

function teamLines(context: RenderContext, bodies: string[], noteFor?: string): string[] {
  const own = bodies.map(() => false);
  const settingLine = bodies.map(() => false);
  bodies.forEach((body, index) => {
    const line = `#${body}`.trim();
    if (context.ownLines.has(line) || line.startsWith('# yaml-language-server:')) {
      own[index] = true;
      return;
    }
    const text = unwrapComment(body);
    if (context.notes.has(text)) {
      own[index] = true;
      return;
    }
    const shape = SETTING_SHAPE.exec(text);
    if (shape !== null && (context.keys.has(shape[1]!) || context.scanned.rendered)) {
      own[index] = true;
      const groupLine =
        (shape[2] ?? '').trim() === '' &&
        context.groupKeys.has(shape[1]!) &&
        !context.leafKeys.has(shape[1]!);
      settingLine[index] = !groupLine;
      return;
    }
    if (
      context.scanned.rendered &&
      text.startsWith('-') &&
      index > 0 &&
      (settingLine[index - 1] ||
        (own[index - 1] && unwrapComment(bodies[index - 1]!).startsWith('-')))
    ) {
      own[index] = true;
    }
  });
  if (context.scanned.rendered) {
    settingLine.forEach((isSetting, index) => {
      if (isSetting && index > 0) own[index - 1] = true;
    });
    if (
      noteFor !== undefined &&
      bodies.length > 0 &&
      !bodies.some((body) => unwrapComment(body) === noteFor)
    ) {
      own[bodies.length - 1] = true;
    }
  }
  return bodies.filter((_body, index) => !own[index]);
}

function teamLinesAbove(
  context: RenderContext,
  path: readonly string[],
  noteFor?: string,
): string[] {
  const key = pathKey(path);
  context.used.add(key);
  const block = context.scanned.blocks.find((entry) => entry.path === key);
  return block === undefined ? [] : teamLines(context, block.bodies, noteFor);
}

function isLiveValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function nodeIsLive(context: RenderContext, node: SettingNode): boolean {
  if (node.setting !== undefined) return isLiveValue(valueAt(context.data, node.path));
  for (const child of node.children.values()) if (nodeIsLive(context, child)) return true;
  return false;
}

function isPlainMap(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function collectUnknownPaths(
  value: Record<string, unknown>,
  node: SettingNode,
  out: Array<readonly string[]>,
): void {
  for (const [key, child] of Object.entries(value)) {
    if (node.path.length === 0 && key === 'paqad_version') continue;
    const known = node.children.get(key);
    if (known === undefined) {
      out.push([...node.path, key]);
      continue;
    }
    if (known.setting !== undefined || child === null || child === undefined) continue;
    if (isPlainMap(child)) collectUnknownPaths(child, known, out);
    else out.push([...node.path, key]);
  }
}

function anchorFor(context: RenderContext, path: readonly string[]): readonly string[] {
  let node = context.tree;
  let anchor: readonly string[] = [];
  for (const segment of path.slice(0, -1)) {
    const child = node.children.get(segment);
    if (child === undefined || !nodeIsLive(context, child)) break;
    anchor = child.path;
    node = child;
  }
  return anchor;
}

function unknownLines(context: RenderContext, anchor: readonly string[], depth: number): string[] {
  const paths = context.anchors.get(pathKey(anchor)) ?? [];
  if (paths.length === 0) return [];
  const map = new YAML.YAMLMap();
  for (const path of paths) {
    let target: YAML.YAMLMap = map;
    const relative = path.slice(anchor.length);
    for (const segment of relative.slice(0, -1)) {
      const found: unknown = target.get(segment, true);
      if (YAML.isMap(found)) {
        target = found;
        continue;
      }
      const next = new YAML.YAMLMap();
      target.items.push(new YAML.Pair(new YAML.Scalar(segment), next));
      target = next;
    }
    const node = context.document!.getIn([...path], true);
    const value = YAML.isNode(node) ? stripNodeComments(node) : node;
    target.items.push(new YAML.Pair(new YAML.Scalar(relative[relative.length - 1]!), value));
  }
  return yamlLines(map, '  '.repeat(depth));
}

function renderSettingNode(
  context: RenderContext,
  node: SettingNode,
  depth: number,
  column: number | null,
  out: string[],
): void {
  const indent = '  '.repeat(depth);
  const live = column === null && nodeIsLive(context, node);
  if (node.setting !== undefined) {
    const note = settingNote(node.setting);
    if (live) {
      for (const line of teamLinesAbove(context, node.path, note)) out.push(`${indent}#${line}`);
      out.push(`${indent}# ${note}`);
      out.push(...liveValueLines(node.key, context.document!.getIn([...node.path], true), indent));
      return;
    }
    out.push(commentAt(`${indent}# ${note}`, column));
    out.push(commentAt(`${indent}${node.key}:${defaultText(node.setting)}`, column ?? depth * 2));
    return;
  }
  if (live) {
    for (const line of teamLinesAbove(context, node.path)) out.push(`${indent}#${line}`);
    out.push(`${indent}${node.key}:`);
    for (const child of node.children.values())
      renderSettingNode(context, child, depth + 1, null, out);
    const extra = unknownLines(context, node.path, depth + 1);
    if (extra.length > 0) out.push(`${indent}  ${NOT_A_SETTING_LINE}`, ...extra);
    return;
  }
  const own = column ?? depth * 2;
  out.push(commentAt(`${indent}${node.key}:`, own));
  for (const child of node.children.values())
    renderSettingNode(context, child, depth + 1, own, out);
}

export function renderTeamConfigFile(
  file: OwnTeamConfigFile,
  live: YAML.Document | null,
  version: string = __PKG_VERSION__,
): string {
  const tree = settingsTree(file);
  const data: unknown = live === null ? null : live.toJS();
  const notes = new Set<string>();
  const keys = new Set<string>();
  const groupKeys = new Set<string>();
  const leafKeys = new Set<string>();
  const walk = (node: SettingNode): void => {
    for (const child of node.children.values()) {
      keys.add(child.key);
      (child.setting === undefined ? groupKeys : leafKeys).add(child.key);
      if (child.setting !== undefined) {
        notes.add(child.setting.note);
        notes.add(settingNote(child.setting));
      }
      walk(child);
    }
  };
  walk(tree);
  const context: RenderContext = {
    file,
    data,
    document: live,
    tree,
    scanned:
      live === null
        ? { rendered: false, blocks: [], notes: [] }
        : scanComments(live.toString({ lineWidth: 0 })),
    ownLines: new Set([
      `# ${TEAM_CONFIG_FILE_DESCRIPTIONS[file]}`,
      ...TEAM_CONFIG_HEADER_LINES,
      ...OLD_HEADER_LINES,
      NOT_A_SETTING_LINE,
      TEAM_NOTES_LINE,
    ]),
    notes,
    keys,
    groupKeys,
    leafKeys,
    used: new Set(),
    anchors: new Map(),
  };
  if (isPlainMap(data)) {
    const unknown: Array<readonly string[]> = [];
    collectUnknownPaths(data, tree, unknown);
    for (const path of unknown) {
      const anchor = pathKey(anchorFor(context, path));
      context.anchors.set(anchor, [...(context.anchors.get(anchor) ?? []), path]);
    }
  }

  const out: string[] = [
    `# yaml-language-server: $schema=${teamConfigSchemaRef(file)}`,
    `# ${TEAM_CONFIG_FILE_DESCRIPTIONS[file]}`,
    ...TEAM_CONFIG_HEADER_LINES,
    `paqad_version: "${version}"`,
  ];
  for (const node of tree.children.values()) {
    out.push('');
    renderSettingNode(context, node, 0, null, out);
  }
  const rootUnknown = unknownLines(context, [], 0);
  if (rootUnknown.length > 0) out.push('', NOT_A_SETTING_LINE, ...rootUnknown);

  const loose: string[] = [];
  for (const block of context.scanned.blocks) {
    if (block.path !== undefined && context.used.has(block.path)) continue;
    loose.push(...teamLines(context, block.bodies));
  }
  const kept = [...context.scanned.notes, ...loose].filter((body) => body.trim() !== '');
  if (kept.length > 0) out.push('', TEAM_NOTES_LINE, ...kept.map((body) => `#${body}`));
  return `${out.join('\n')}\n`;
}

export interface TeamConfigRepair {
  line: number;
  message: string;
}

function uncommentLine(line: string): string {
  const column = indentOf(line);
  const rest = line.slice(column + 1);
  return `${line.slice(0, column)}${rest.startsWith(' ') ? rest.slice(1) : rest}`;
}

function childAt(tree: SettingNode, path: readonly string[]): SettingNode | undefined {
  let node: SettingNode | undefined = tree;
  for (const segment of path) {
    node = node?.children.get(segment);
    if (node === undefined) return undefined;
  }
  return node;
}

function groupLineKey(line: string): string | null {
  if (line.trimStart().startsWith('#')) return null;
  const match = /^\s*([A-Za-z0-9_][A-Za-z0-9_.-]*):\s*(?:#.*)?$/u.exec(line);
  return match === null ? null : match[1]!;
}

export function repairTeamConfigText(
  file: OwnTeamConfigFile,
  text: string,
): { text: string; repairs: TeamConfigRepair[] } {
  const tree = settingsTree(file);
  const lines = text.split('\n');
  const repairs: TeamConfigRepair[] = [];
  const stack: Array<{ column: number; key: string }> = [];
  let blockColumn = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (blockColumn >= 0) {
      if (line.trim() === '' || indentOf(line) > blockColumn) continue;
      blockColumn = -1;
    }
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    let column = indentOf(line);
    const match = KEY_LINE.exec(line);
    if (match === null) {
      while (stack.length > 0 && stack[stack.length - 1]!.column >= column) stack.pop();
      if (trimmed.startsWith('-')) stack.push({ column, key: SEQUENCE_MARK });
      if (BLOCK_SCALAR.test(line)) blockColumn = column;
      continue;
    }
    const key = match[2] ?? match[3] ?? match[4]!;

    let start = index;
    while (start > 0 && lines[start - 1]!.trim().startsWith('#')) start -= 1;
    const chain: Array<{ index: number; column: number; key: string }> = [];
    let limit = column % 2 === 1 ? column - 1 : column;
    for (let row = index - 1; row >= start; row -= 1) {
      const virtual = uncommentLine(lines[row]!);
      const virtualColumn = indentOf(virtual);
      if (virtualColumn >= limit || virtual.trimStart().startsWith('#')) continue;
      const groupKey = groupLineKey(virtual);
      if (groupKey === null) break;
      chain.unshift({ index: row, column: virtualColumn, key: groupKey });
      limit = virtualColumn;
    }
    let repaired = false;
    if (chain.length > 0) {
      const outer = chain[0]!.column;
      const parents = stack.filter((frame) => frame.column < outer);
      const parentPath = parents.map((frame) => frame.key);
      const path = [...parentPath, ...chain.map((link) => link.key), key];
      if (childAt(tree, path) !== undefined) {
        for (const link of chain) lines[link.index] = uncommentLine(lines[link.index]!);
        stack.length = parents.length;
        for (const link of chain) stack.push({ column: link.column, key: link.key });
        const group = chain[chain.length - 1]!;
        repairs.push({
          line: index + 1,
          message:
            `${file} line ${index + 1}: ${key} is set, but the # is still in front of ` +
            `${group.key}: on line ${group.index + 1}. paqad reads ${key} anyway; remove the # ` +
            `in front of ${group.key}: (paqad-ai update does this for you).`,
        });
        repaired = true;
        if (column === group.column + 3) {
          lines[index] = line.slice(1);
          column -= 1;
        }
      }
    }
    while (stack.length > 0 && stack[stack.length - 1]!.column >= column) stack.pop();
    const parents = stack.filter((frame) => frame.column < column - 1);
    const parent = parents[parents.length - 1];
    const expected = parent === undefined ? 0 : parent.column + 2;
    const parentPath = parents.map((frame) => frame.key);
    if (!repaired && column === expected + 1 && childAt(tree, [...parentPath, key]) !== undefined) {
      stack.length = parents.length;
      lines[index] = line.slice(1);
      for (let next = index + 1; next < lines.length; next += 1) {
        const following = lines[next]!;
        if (following.trim() === '') continue;
        if (following.trimStart().startsWith('#') || indentOf(following) <= column) break;
        lines[next] = following.slice(1);
      }
      repairs.push({
        line: index + 1,
        message:
          `${file} line ${index + 1}: ${key} is one column deeper than paqad's layout. ` +
          'paqad reads it at its own column; remove the extra space (paqad-ai update does this for you).',
      });
      column -= 1;
    }
    stack.push({ column, key });
    if (BLOCK_SCALAR.test(lines[index]!)) blockColumn = column;
  }
  return { text: lines.join('\n'), repairs };
}
