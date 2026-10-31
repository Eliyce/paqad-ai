import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { builtinSecretScan } from '@/codebase-health/gather.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';
import { estimateTokens } from '@/stage-isolation/subagent-completion.js';

import { skillTestDirectories } from '../tests/locations.js';
import { allowedSkillFields, DESCRIPTION_MAX_CHARS, descriptionLength } from './fields.js';
import {
  compileNeverWritePattern,
  loadNeverWriteList,
  type NeverWriteList,
} from './never-write.js';

export type SkillLintSeverity = 'block' | 'warn';

export interface SkillLintFinding {
  rule: string;
  severity: SkillLintSeverity;
  file: string;
  line: number;
  message: string;
  fingerprint?: string;
}

export interface SkillLintResult {
  skill: string;
  findings: SkillLintFinding[];
  blocking: number;
  warnings: number;
}

export interface SkillLintOptions {
  projectRoot: string;
  claudeCode?: boolean;
  bodyMaxTokens?: number;
  extraScanRoots?: readonly string[];
  neverWrite?: NeverWriteList;
}

export class SkillLintUsageError extends Error {}

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;
export const BODY_MAX_LINES = 500;
export const REFERENCE_TOC_THRESHOLD = 100;
const DEFAULT_BODY_MAX_TOKENS = 5000;
const BINARY_SNIFF_BYTES = 8000;
const VAGUE_NAME_WORDS: ReadonlySet<string> = new Set([
  'helper',
  'utils',
  'tools',
  'documents',
  'data',
  'files',
]);
const RESERVED_NAME_WORDS = ['claude', 'anthropic'];
const EM_DASH = '\u2014';

const WHEN_CLAUSE = /\bwhen\b/i;
const SHOUTED = /\b(ALWAYS|NEVER|MUST|CRITICAL)\b/;
const OPTIONS_INTRO = /\b(?:you can|either)\b|\boptions?:/i;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const DEFAULT_MARKER = /\b(?:default|recommended|prefer)/i;
const TIME_SENSITIVE =
  /\b(?:currently|recently|as of now|new|latest|before|after) (?:version|release|api)\b/i;
const YEAR = /\b(?:19|20)\d{2}\b/;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const CLOCK_TIME = /\b\d{1,2}:\d{2}:\d{2}\b/;
const DYNAMIC_PLACEHOLDER = /\{\{\s*(?:now|date|time|timestamp|today|counter|random|uuid)\s*\}\}/i;
const COUNTER = /\b(?:run|iteration|attempt|build|request)\s*(?:#|no\.?\s*)\d+\b/i;
const VERIFICATION_LINE = /\b(?:human-verified|verified|last checked|checked on)\b/i;
const TOC_LINE = /^#{1,6}\s*(?:table of )?contents\b|^\s*[-*]\s*\[[^\]]+\]\(#[^)]+\)/i;
const REFERENCE_CITE = /(?:^|[\s(`'"[<])((?:\.\/)?references\/[^\s)`'">\]]+)/g;
const SHELL_READ = /(?:^|[;&|]\s*|\bwhile\s+|\bthen\s+|\bdo\s+)read\s+/;
const INTERACTIVE_CALLS = ['input(', 'readline', 'prompt(', 'STDIN.gets', 'fgets(STDIN'];
const PEP723_START = /^#\s*\/\/\/\s*script\s*$/;
const PEP723_END = /^#\s*\/\/\/\s*$/;
const QUOTED = /["']([^"']+)["']/g;
const PINNED_PEP508 = /(?:===?|~=|<=?|>=?|!=|@)/;
const NPM_SPECIFIER = /["']npm:((?:@[^/"']+\/)?[^@"'/]+)(@[^"']+)?["']/g;

interface SkillFile {
  rel: string;
  text: string | null;
  lines: string[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function readTree(root: string, prefix = ''): SkillFile[] {
  const files: SkillFile[] = [];
  const entries = readdirSync(join(root, prefix), { withFileTypes: true })
    .map((entry) => entry.name)
    .sort(compareText);
  for (const name of entries) {
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    const stat = lstatSync(join(root, rel));
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      files.push(...readTree(root, rel));
      continue;
    }
    const buffer = readFileSync(join(root, rel));
    const text = isBinary(buffer) ? null : buffer.toString('utf8');
    files.push({ rel, text, lines: text === null ? [] : text.split(/\r?\n/) });
  }
  return files;
}

function isMarkdown(rel: string): boolean {
  return rel.toLowerCase().endsWith('.md');
}

function under(rel: string, folder: string): boolean {
  return rel.startsWith(`${folder}/`);
}

class FindingSink {
  readonly findings: SkillLintFinding[] = [];

  add(rule: string, severity: SkillLintSeverity, file: string, line: number, message: string) {
    this.findings.push({ rule, severity, file, line, message });
  }

  block(rule: string, file: string, line: number, message: string) {
    this.add(rule, 'block', file, line, message);
  }

  warn(rule: string, file: string, line: number, message: string) {
    this.add(rule, 'warn', file, line, message);
  }
}

function keyLine(frontmatterLines: readonly string[], key: string): number {
  const index = frontmatterLines.findIndex((line) => line.startsWith(`${key}:`));
  return index === -1 ? 1 : index + 2;
}

function checkName(sink: FindingSink, name: unknown, folderName: string, line: number): void {
  if (typeof name !== 'string' || name.trim() === '') {
    sink.block(
      'SK-001',
      'SKILL.md',
      line,
      'The name field is missing. Add one that matches the folder.',
    );
    return;
  }
  if (name.length > SKILL_NAME_MAX) {
    sink.block('SK-001', 'SKILL.md', line, `The name is longer than ${SKILL_NAME_MAX} characters.`);
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    sink.block(
      'SK-001',
      'SKILL.md',
      line,
      'The name may only use a-z, 0-9 and single hyphens, with no hyphen at either end.',
    );
  }
  if (name !== folderName) {
    sink.block(
      'SK-001',
      'SKILL.md',
      line,
      `The name "${name}" differs from the folder "${folderName}".`,
    );
  }
  const reserved = RESERVED_NAME_WORDS.find((word) => name.toLowerCase().includes(word));
  if (reserved !== undefined) {
    sink.block('SK-002', 'SKILL.md', line, `The name contains "${reserved}", which is reserved.`);
  }
  for (const word of name.split('-')) {
    if (VAGUE_NAME_WORDS.has(word)) {
      sink.warn(
        'SK-003',
        'SKILL.md',
        line,
        `The name uses the vague word "${word}". Name the job the skill does.`,
      );
    }
  }
  const first = name.split('-')[0] ?? '';
  if (!first.endsWith('ing')) {
    sink.warn(
      'SK-004',
      'SKILL.md',
      line,
      `The name breaks the gerund pattern: its first word "${first}" does not end in "ing".`,
    );
  }
}

function checkDescription(sink: FindingSink, description: unknown, line: number): void {
  if (typeof description !== 'string' || description.trim() === '') {
    sink.block('SK-005', 'SKILL.md', line, 'The description field is missing.');
    return;
  }
  const length = descriptionLength(description);
  if (length > DESCRIPTION_MAX_CHARS) {
    sink.block(
      'SK-005',
      'SKILL.md',
      line,
      `The description is ${length} characters; the limit is ${DESCRIPTION_MAX_CHARS}.`,
    );
  }
  if (description.includes('<') || description.includes('>')) {
    sink.block('SK-005', 'SKILL.md', line, 'The description contains "<" or ">".');
  }
  if (!WHEN_CLAUSE.test(description)) {
    sink.block(
      'SK-005',
      'SKILL.md',
      line,
      'The description has no "when" clause. Add "Use when ...".',
    );
  }
}

function checkFrontmatter(
  sink: FindingSink,
  skillFile: SkillFile,
  folderName: string,
  options: SkillLintOptions,
): { body: string; bodyStartLine: number } | null {
  const split = splitSkillFrontmatter(skillFile.text ?? '');
  if (!split.ok) {
    sink.block('SK-001', 'SKILL.md', 1, `The frontmatter could not be read: ${split.message}.`);
    return null;
  }
  checkName(sink, split.data.name, folderName, keyLine(split.frontmatterLines, 'name'));
  checkDescription(sink, split.data.description, keyLine(split.frontmatterLines, 'description'));
  const allowed = allowedSkillFields(options.claudeCode !== false);
  for (const key of Object.keys(split.data).sort(compareText)) {
    if (!allowed.has(key)) {
      sink.block(
        'SK-006',
        'SKILL.md',
        keyLine(split.frontmatterLines, key),
        `The frontmatter key "${key}" is not a documented skill field.`,
      );
    }
  }
  return { body: split.body, bodyStartLine: split.bodyStartLine };
}

function checkBody(sink: FindingSink, body: string, maxTokens: number): void {
  const lines = body.replace(/(?:\r?\n)+$/u, '').split(/\r?\n/);
  if (lines.length > BODY_MAX_LINES) {
    sink.block(
      'SK-008',
      'SKILL.md',
      1,
      `The body is ${lines.length} lines; the limit is ${BODY_MAX_LINES}.`,
    );
  }
  const tokens = estimateTokens(body);
  if (tokens > maxTokens) {
    sink.block(
      'SK-008',
      'SKILL.md',
      1,
      `The body is about ${tokens} tokens; the limit is ${maxTokens}.`,
    );
  }
}

function citesIn(file: SkillFile): Array<{ target: string; line: number }> {
  const cites: Array<{ target: string; line: number }> = [];
  file.lines.forEach((text, index) => {
    for (const match of text.matchAll(REFERENCE_CITE)) {
      const target = match[1]!.replace(/^\.\//u, '').replace(/[.,;:!?]+$/u, '');
      if (!target.endsWith('/')) cites.push({ target, line: index + 1 });
    }
  });
  return cites;
}

function checkReferences(
  sink: FindingSink,
  files: readonly SkillFile[],
  skillFile: SkillFile,
): void {
  const references = files.filter((file) => under(file.rel, 'references'));
  const known = new Set(references.map((file) => file.rel));
  const cited = new Set<string>();
  for (const cite of citesIn(skillFile)) {
    cited.add(cite.target);
    if (!known.has(cite.target)) {
      sink.block('SK-009', 'SKILL.md', cite.line, `The cited file ${cite.target} does not exist.`);
    }
  }
  for (const file of references) {
    if (!cited.has(file.rel)) {
      sink.block('SK-009', file.rel, 1, `${file.rel} is never cited from SKILL.md.`);
    }
    for (const cite of citesIn(file)) {
      if (cite.target === file.rel) continue;
      sink.block(
        'SK-009',
        file.rel,
        cite.line,
        `${file.rel} points to ${cite.target}; references stay one level deep from SKILL.md.`,
      );
    }
  }
}

function testFilesFor(projectRoot: string, skill: string): string[] {
  const found: string[] = [];
  for (const dir of skillTestDirectories(skill)) {
    const abs = join(projectRoot, dir);
    if (!existsSync(abs)) continue;
    found.push(...readTree(abs).map((file) => `${dir}/${file.rel}`));
  }
  return found;
}

function scriptStem(rel: string): string {
  const name = basename(rel);
  const dot = name.indexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

function checkScripts(
  sink: FindingSink,
  files: readonly SkillFile[],
  testFiles: readonly string[],
): void {
  for (const file of files.filter((entry) => under(entry.rel, 'scripts') && entry.text !== null)) {
    if (!file.text!.includes('--help')) {
      sink.block('SK-010', file.rel, 1, `The script ${file.rel} has no --help.`);
    }
    file.lines.forEach((text, index) => {
      const call = INTERACTIVE_CALLS.find((needle) => text.includes(needle));
      if (call !== undefined || SHELL_READ.test(text.trim())) {
        sink.block(
          'SK-010',
          file.rel,
          index + 1,
          `The script ${file.rel} reads input interactively (${call ?? 'read'}). Take it from a flag or a file.`,
        );
      }
    });
    const stem = scriptStem(file.rel).toLowerCase();
    if (!testFiles.some((test) => basename(test).toLowerCase().includes(stem))) {
      sink.block(
        'SK-010',
        file.rel,
        1,
        `The script ${file.rel} has no test file under the tests directory.`,
      );
    }
  }
}

function checkSecrets(
  sink: FindingSink,
  files: ReadonlyArray<{ path: string; content: string }>,
): void {
  for (const match of builtinSecretScan([...files])) {
    sink.findings.push({
      rule: 'SK-011',
      severity: 'block',
      file: match.file,
      line: match.line,
      message: `A secret (${match.rule}) is in this file, fingerprint ${match.fingerprint}. Remove it; a secret can never be approved.`,
      fingerprint: match.fingerprint,
    });
  }
}

function checkProse(sink: FindingSink, file: SkillFile, neverWrite: RegExp): void {
  const lines = file.lines;
  lines.forEach((text, index) => {
    const line = index + 1;
    neverWrite.lastIndex = 0;
    for (const match of text.matchAll(neverWrite)) {
      const phrase = match[0].toLowerCase().replace(/\s+/g, ' ');
      sink.block('SK-012', file.rel, line, `Generic phrase "${phrase}". Say what it means here.`);
    }
    const shouted = SHOUTED.exec(text);
    if (shouted) {
      sink.block(
        'SK-013',
        file.rel,
        line,
        `"${shouted[1]}" in capitals. Say why instead of shouting.`,
      );
    }
    if (OPTIONS_INTRO.test(text) && missingDefault(lines, index)) {
      sink.block(
        'SK-014',
        file.rel,
        line,
        'An options list with no stated default. Name the default.',
      );
    }
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (TIME_SENSITIVE.test(sentence) && !YEAR.test(sentence)) {
        sink.block('SK-015', file.rel, line, 'Time-sensitive wording with no date. Add the year.');
        break;
      }
    }
  });
}

function missingDefault(lines: readonly string[], index: number): boolean {
  let cursor = index + 1;
  if (cursor < lines.length && lines[cursor]!.trim() === '') cursor += 1;
  let items = 0;
  while (cursor + items < lines.length && LIST_ITEM.test(lines[cursor + items]!)) items += 1;
  if (items < 3) return false;
  const window = lines.slice(index, cursor + items + 2).join('\n');
  return !DEFAULT_MARKER.test(window);
}

function checkDynamic(sink: FindingSink, file: SkillFile, firstLine: number): void {
  file.lines.forEach((text, index) => {
    const line = index + 1;
    if (line < firstLine || VERIFICATION_LINE.test(text)) return;
    if (
      ISO_DATE.test(text) ||
      CLOCK_TIME.test(text) ||
      DYNAMIC_PLACEHOLDER.test(text) ||
      COUNTER.test(text)
    ) {
      sink.block(
        'SK-017',
        file.rel,
        line,
        'Dynamic content (a date, a time, a placeholder or a counter). Keep the text the same on every run.',
      );
    }
  });
}

function checkEmDash(sink: FindingSink, file: SkillFile): void {
  file.lines.forEach((text, index) => {
    if (text.includes(EM_DASH)) {
      sink.block(
        'SK-016',
        file.rel,
        index + 1,
        'An em dash (U+2014). Use a comma, a colon or two sentences.',
      );
    }
  });
}

function checkTableOfContents(sink: FindingSink, file: SkillFile): void {
  const length = file.lines.length - (file.lines.at(-1) === '' ? 1 : 0);
  if (length <= REFERENCE_TOC_THRESHOLD) return;
  if (!file.lines.slice(0, 20).some((line) => TOC_LINE.test(line))) {
    sink.block(
      'SK-018',
      file.rel,
      1,
      `${file.rel} is ${length} lines with no table of contents in its first 20 lines.`,
    );
  }
}

function checkInlineDependencies(sink: FindingSink, file: SkillFile): void {
  let inBlock = false;
  file.lines.forEach((text, index) => {
    if (PEP723_START.test(text)) {
      inBlock = true;
      return;
    }
    if (inBlock && PEP723_END.test(text)) {
      inBlock = false;
      return;
    }
    const unpinned: string[] = [];
    if (inBlock && !/requires-python/.test(text)) {
      for (const match of text.matchAll(QUOTED)) {
        if (!PINNED_PEP508.test(match[1]!)) unpinned.push(match[1]!);
      }
    }
    for (const match of text.matchAll(NPM_SPECIFIER)) {
      if (match[2] === undefined) unpinned.push(`npm:${match[1]}`);
    }
    for (const dependency of unpinned) {
      sink.warn(
        'SK-019',
        file.rel,
        index + 1,
        `The inline dependency "${dependency}" has no pinned version.`,
      );
    }
  });
}

function extraScanFiles(
  roots: readonly string[],
  projectRoot: string,
): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  for (const root of roots) {
    const abs = join(projectRoot, root);
    if (!existsSync(abs)) continue;
    for (const file of readTree(abs)) {
      if (file.text !== null) files.push({ path: `${root}/${file.rel}`, content: file.text });
    }
  }
  return files;
}

function sortFindings(findings: SkillLintFinding[]): SkillLintFinding[] {
  return findings.sort(
    (left, right) =>
      compareText(left.file, right.file) ||
      left.line - right.line ||
      compareText(left.rule, right.rule) ||
      compareText(left.message, right.message),
  );
}

export function lintSkillFolder(folder: string, options: SkillLintOptions): SkillLintResult {
  if (!existsSync(folder) || !lstatSync(folder).isDirectory()) {
    throw new SkillLintUsageError(`${folder} is not a folder`);
  }
  const files = readTree(folder);
  const skillFiles = files.filter((file) => basename(file.rel) === 'SKILL.md');
  const skillFile = files.find((file) => file.rel === 'SKILL.md');
  if (skillFile === undefined) {
    throw new SkillLintUsageError(`${folder} holds no SKILL.md, so it is not a skill folder`);
  }
  const folderName = basename(folder.replace(/[\\/]+$/u, ''));
  const sink = new FindingSink();
  const neverWrite = compileNeverWritePattern(
    (options.neverWrite ?? loadNeverWriteList(options.projectRoot)).phrases,
  );

  const parsed = checkFrontmatter(sink, skillFile, folderName, options);
  if (parsed !== null)
    checkBody(sink, parsed.body, options.bodyMaxTokens ?? DEFAULT_BODY_MAX_TOKENS);
  for (const extra of skillFiles.filter((file) => file !== skillFile)) {
    sink.block('SK-007', extra.rel, 1, 'A second SKILL.md in the folder. Keep one per skill.');
  }
  checkReferences(sink, files, skillFile);
  const testDirs = skillTestDirectories(folderName);
  checkScripts(sink, files, testFilesFor(options.projectRoot, folderName));

  const textFiles = files.filter((file) => file.text !== null);
  checkSecrets(sink, [
    ...textFiles.map((file) => ({ path: file.rel, content: file.text! })),
    ...extraScanFiles([...testDirs, ...(options.extraScanRoots ?? [])], options.projectRoot),
  ]);
  for (const file of textFiles) {
    checkEmDash(sink, file);
    if (isMarkdown(file.rel)) checkProse(sink, file, neverWrite);
    if (file === skillFile && parsed !== null) checkDynamic(sink, file, parsed.bodyStartLine);
    if (under(file.rel, 'references')) {
      checkDynamic(sink, file, 1);
      checkTableOfContents(sink, file);
    }
    if (under(file.rel, 'scripts')) checkInlineDependencies(sink, file);
  }

  const findings = sortFindings(sink.findings);
  const blocking = findings.filter((finding) => finding.severity === 'block').length;
  return { skill: folderName, findings, blocking, warnings: findings.length - blocking };
}

export function skillLintExitCode(result: SkillLintResult): 0 | 1 {
  return result.blocking > 0 ? 1 : 0;
}

export function formatSkillLintJson(result: SkillLintResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
