import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { validateCodeKnowledgeIndex } from './schema.js';
import type { CodeKnowledgeIndex } from './types.js';

export function codeKnowledgeIndexPath(projectRoot: string): string {
  return join(projectRoot, PATHS.CODE_KNOWLEDGE_INDEX);
}

export function writeCodeKnowledgeIndex(projectRoot: string, index: CodeKnowledgeIndex): string {
  const target = codeKnowledgeIndexPath(projectRoot);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
  return target;
}

export function readCodeKnowledgeIndex(projectRoot: string): CodeKnowledgeIndex | null {
  const target = codeKnowledgeIndexPath(projectRoot);
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf8')) as unknown;
    return validateCodeKnowledgeIndex(parsed).valid ? (parsed as CodeKnowledgeIndex) : null;
  } catch {
    return null;
  }
}
