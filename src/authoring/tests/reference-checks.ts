import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { listFolderFiles } from '../hash.js';

export interface ReferenceFinding {
  file: string;
  line: number;
  message: string;
}

export interface BlockRun {
  exitCode: number;
  output: string;
}

export type BlockRunner = (language: string, code: string, cwd: string) => BlockRun;

export const RUNNABLE_TIMEOUT_MS = 5000;

const VERIFICATION = /\b(?:human-verified|verified)\s*:\s*\d{4}-\d{2}-\d{2}\b/i;
const HUMAN_VERIFIED = /\bhuman-verified\s*:\s*\d{4}-\d{2}-\d{2}\b/i;
const VALIDATES = /\bvalidates=(\S+)/u;
const TASK_COMMAND = /^(make|just)\s+([\w:.-]+)/u;
const PARSEABLE: Record<string, 'json' | 'yaml'> = { json: 'json', yaml: 'yaml', yml: 'yaml' };
const INLINE_CODE = /`([^`\n]+)`/g;
const FENCE = /^\s*(```+|~~~+)\s*([^\s`]*)\s*(.*)$/u;
const SKILL_LOCAL = /^(?:references|scripts|assets)\//u;
const SCRIPT_COMMAND =
  /^(?:npm|pnpm|yarn)\s+(?:run\s+)?([\w:.-]+)|^composer\s+(?:run-script\s+)?([\w:.-]+)/u;
const PACKAGE_MANAGER_BUILTINS = new Set([
  'install',
  'i',
  'add',
  'remove',
  'ci',
  'test',
  'exec',
  'dlx',
  'require',
  'update',
  'dump-autoload',
]);

export function defaultBlockRunner(language: string, code: string, cwd: string): BlockRun {
  const node = language === 'node' || language === 'js' || language === 'javascript';
  const result = spawnSync(node ? process.execPath : 'bash', node ? ['-e', code] : ['-c', code], {
    cwd,
    encoding: 'utf8',
    timeout: RUNNABLE_TIMEOUT_MS,
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? result.error.message : ''}`,
  };
}

function looksLikePath(token: string): boolean {
  if (/\s/u.test(token) || /^[a-z]+:\/\//iu.test(token) || token.startsWith('-')) return false;
  if (/[*?<>{}$]/u.test(token)) return false;
  return token.includes('/') && (/\.[A-Za-z0-9]+$/u.test(token) || token.endsWith('/'));
}

function packageScripts(projectRoot: string): Set<string> {
  const names = new Set<string>();
  for (const file of ['package.json', 'composer.json']) {
    try {
      const parsed = JSON.parse(readFileSync(join(projectRoot, file), 'utf8')) as {
        scripts?: Record<string, unknown>;
      };
      for (const name of Object.keys(parsed.scripts ?? {})) names.add(name);
    } catch {
      continue;
    }
  }
  return names;
}

function taskTargets(projectRoot: string, tool: string): Set<string> {
  const files =
    tool === 'make' ? ['Makefile', 'makefile', 'GNUmakefile'] : ['justfile', 'Justfile'];
  const names = new Set<string>();
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(projectRoot, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const target = /^([\w.-]+)(?:\s+[\w.-]+)*\s*:(?!=)/u.exec(line);
      if (target) names.add(target[1]!);
    }
  }
  return names;
}

function checkInline(
  file: string,
  lines: readonly string[],
  context: { projectRoot: string; skillFolder: string; scripts: Set<string> },
): ReferenceFinding[] {
  const findings: ReferenceFinding[] = [];
  let inFence = false;
  lines.forEach((text, index) => {
    if (FENCE.test(text)) {
      inFence = !inFence;
      return;
    }
    if (inFence || /\bexternal\b/iu.test(text)) return;
    for (const match of text.matchAll(INLINE_CODE)) {
      const token = match[1]!.trim();
      const task = TASK_COMMAND.exec(token);
      if (task) {
        if (!taskTargets(context.projectRoot, task[1]!).has(task[2]!)) {
          findings.push({
            file,
            line: index + 1,
            message: `The command "${token}" names a ${task[1]} target the project does not define. Fix it or mark it external.`,
          });
        }
        continue;
      }
      const command = SCRIPT_COMMAND.exec(token);
      if (command) {
        const script = command[1] ?? command[2]!;
        if (!PACKAGE_MANAGER_BUILTINS.has(script) && !context.scripts.has(script)) {
          findings.push({
            file,
            line: index + 1,
            message: `The command "${token}" names a script the project does not define. Fix it or mark it external.`,
          });
        }
        continue;
      }
      if (!looksLikePath(token)) continue;
      const base = SKILL_LOCAL.test(token) ? context.skillFolder : context.projectRoot;
      if (!existsSync(join(base, token.replace(/^\.\//u, '')))) {
        findings.push({
          file,
          line: index + 1,
          message: `The path ${token} does not exist. Fix it or mark it external.`,
        });
      }
    }
  });
  return findings;
}

function parseData(kind: 'json' | 'yaml', text: string): unknown {
  return kind === 'json' ? JSON.parse(text) : YAML.parse(text);
}

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    paths.push(path, ...keyPaths(child, path));
  }
  return paths;
}

function validateExample(
  example: { language: string; target: string; body: string },
  projectRoot: string,
  humanVerified: boolean,
): string | null {
  const exampleKind = PARSEABLE[example.language];
  const targetKind = PARSEABLE[example.target.split('.').pop()?.toLowerCase() ?? ''];
  if (exampleKind === undefined || targetKind === undefined) {
    return humanVerified
      ? null
      : `The example for ${example.target} can't be validated automatically (only JSON and YAML can). Mark the reference human-verified: <date>.`;
  }
  let real: unknown;
  try {
    real = parseData(targetKind, readFileSync(join(projectRoot, example.target), 'utf8'));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? `The example names ${example.target}, which does not exist.`
      : `${example.target} could not be parsed as ${targetKind.toUpperCase()}.`;
  }
  let parsed: unknown;
  try {
    parsed = parseData(exampleKind, example.body);
  } catch {
    return `The example for ${example.target} is not valid ${exampleKind.toUpperCase()}.`;
  }
  const known = new Set(keyPaths(real));
  const missing = keyPaths(parsed).filter((path) => !known.has(path));
  return missing.length === 0
    ? null
    : `The example uses keys ${example.target} does not have: ${missing.join(', ')}.`;
}

function checkBlocks(
  file: string,
  lines: readonly string[],
  projectRoot: string,
  runner: BlockRunner,
): ReferenceFinding[] {
  const findings: ReferenceFinding[] = [];
  const humanVerified = lines.some((line) => HUMAN_VERIFIED.test(line));
  let open: {
    line: number;
    language: string;
    runnable: boolean;
    target: string | null;
    body: string[];
  } | null = null;
  lines.forEach((text, index) => {
    const fence = FENCE.exec(text);
    if (!fence) {
      open?.body.push(text);
      return;
    }
    if (open === null) {
      const info = fence[3] ?? '';
      open = {
        line: index + 1,
        language: fence[2]!.toLowerCase(),
        runnable: /\brunnable\b/u.test(info) || fence[2] === 'runnable',
        target: VALIDATES.exec(info)?.[1] ?? null,
        body: [],
      };
      return;
    }
    if (open.runnable) {
      const result = runner(open.language, open.body.join('\n'), projectRoot);
      if (result.exitCode !== 0) {
        findings.push({
          file,
          line: open.line,
          message: `The runnable block exits ${result.exitCode}.`,
        });
      }
    }
    if (open.target !== null) {
      const problem = validateExample(
        { language: open.language, target: open.target, body: open.body.join('\n') },
        projectRoot,
        humanVerified,
      );
      if (problem !== null) findings.push({ file, line: open.line, message: problem });
    }
    open = null;
  });
  return findings;
}

export function checkSkillReferences(input: {
  skillFolder: string;
  projectRoot: string;
  runner?: BlockRunner;
}): ReferenceFinding[] {
  const scripts = packageScripts(input.projectRoot);
  const findings: ReferenceFinding[] = [];
  for (const entry of listFolderFiles(input.skillFolder)) {
    if (!entry.rel.startsWith('references/') || !entry.rel.endsWith('.md')) continue;
    const lines = entry.bytes.toString('utf8').split(/\r?\n/);
    if (!lines.some((line) => VERIFICATION.test(line))) {
      findings.push({
        file: entry.rel,
        line: 1,
        message: `${entry.rel} carries no verification date. Add "verified: YYYY-MM-DD", or "human-verified: YYYY-MM-DD" when it can't be checked automatically.`,
      });
    }
    findings.push(
      ...checkInline(entry.rel, lines, {
        projectRoot: input.projectRoot,
        skillFolder: input.skillFolder,
        scripts,
      }),
      ...checkBlocks(entry.rel, lines, input.projectRoot, input.runner ?? defaultBlockRunner),
    );
  }
  return findings.sort(
    (left, right) =>
      (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) || left.line - right.line,
  );
}
