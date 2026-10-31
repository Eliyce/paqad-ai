import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function checkRunnable(
  file: string,
  lines: readonly string[],
  projectRoot: string,
  runner: BlockRunner,
): ReferenceFinding[] {
  const findings: ReferenceFinding[] = [];
  let open: { line: number; language: string; runnable: boolean; body: string[] } | null = null;
  lines.forEach((text, index) => {
    const fence = FENCE.exec(text);
    if (!fence) {
      open?.body.push(text);
      return;
    }
    if (open === null) {
      open = {
        line: index + 1,
        language: fence[2]!.toLowerCase(),
        runnable: /\brunnable\b/u.test(fence[3] ?? '') || fence[2] === 'runnable',
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
      ...checkRunnable(entry.rel, lines, input.projectRoot, input.runner ?? defaultBlockRunner),
    );
  }
  return findings.sort(
    (left, right) =>
      (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) || left.line - right.line,
  );
}
