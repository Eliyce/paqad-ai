import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  AffectsBehaviourVerdict,
  FixChange,
  FixChangedFile,
} from '@/core/types/fix-protocol.js';
import {
  isDocumentationFile,
  isPaqadArtifactPath,
  isTestFile,
} from '@/pipeline/change-evidence.js';
import { readGitState } from '@/rag/git-state.js';

import { affectsBehaviour } from './affects-behaviour.js';

export type GitOutput = (projectRoot: string, args: string[]) => string | null;

export function gitOutput(projectRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function stripPrefix(path: string): string {
  return path.replace(/^[ab]\//, '').replace(/\\/g, '/');
}

export function parseChangedLines(diffText: string): FixChangedFile[] {
  const byFile = new Map<string, FixChangedFile>();
  let fromPath: string | null = null;
  let current: FixChangedFile | null = null;
  let inHunk = false;

  const fileFor = (path: string): FixChangedFile => {
    const existing = byFile.get(path);
    if (existing) return existing;
    const created: FixChangedFile = { path, added_lines: [], removed_lines: [] };
    byFile.set(path, created);
    return created;
  };

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      current = null;
      fromPath = null;
      continue;
    }
    if (!inHunk && line.startsWith('--- ')) {
      const source = line.slice(4).trim();
      fromPath = source === '/dev/null' ? null : stripPrefix(source);
      continue;
    }
    if (!inHunk && line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      const path = target === '/dev/null' ? fromPath : stripPrefix(target);
      current = path === null ? null : fileFor(path);
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = current !== null;
      continue;
    }
    if (!inHunk || current === null) continue;
    if (line.startsWith('+')) current.added_lines.push(line.slice(1));
    else if (line.startsWith('-')) current.removed_lines.push(line.slice(1));
  }
  return [...byFile.values()];
}

export function isBehaviourCandidate(path: string): boolean {
  return !isTestFile(path) && !isDocumentationFile(path) && !isPaqadArtifactPath(path);
}

function untrackedFiles(projectRoot: string, runGit: GitOutput): FixChangedFile[] {
  const listed = runGit(projectRoot, ['ls-files', '--others', '--exclude-standard']);
  if (listed === null) return [];
  return listed
    .split('\n')
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .flatMap((path) => {
      try {
        const content = readFileSync(join(projectRoot, path), 'utf8');
        return [{ path, added_lines: content.split('\n'), removed_lines: [] }];
      } catch {
        return [];
      }
    });
}

export function readChangeDiff(
  projectRoot: string,
  runGit: GitOutput = gitOutput,
): FixChange | null {
  const state = readGitState(projectRoot);
  if (!state.head_commit) return null;
  const base = state.base_commit ?? 'HEAD';
  const diff = runGit(projectRoot, ['diff', '--no-color', '--unified=0', base]);
  if (diff === null) return null;
  const tracked = parseChangedLines(diff);
  const seen = new Set(tracked.map((file) => file.path));
  const untracked = untrackedFiles(projectRoot, runGit).filter((file) => !seen.has(file.path));
  return { files: [...tracked, ...untracked] };
}

export function behaviourChangeOf(change: FixChange): FixChange {
  return { files: change.files.filter((file) => isBehaviourCandidate(file.path)) };
}

export function changeAffectsBehaviour(change: FixChange): AffectsBehaviourVerdict {
  const candidates = behaviourChangeOf(change);
  if (candidates.files.length === 0) {
    return {
      affects: false,
      reason: 'The change touches only tests, docs or paqad records.',
      behavioural_evidence: [],
    };
  }
  return affectsBehaviour(candidates);
}
