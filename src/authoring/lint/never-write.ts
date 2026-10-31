import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { getRuntimeRoot } from '@/core/runtime-paths.js';

export const NEVER_WRITE_SCHEMA_VERSION = '1';

export const PROJECT_NEVER_WRITE_PATH = 'docs/instructions/rules/authoring/never-write.yaml';

export function frameworkNeverWritePath(): string {
  return join(getRuntimeRoot(), 'base', 'authoring', 'never-write.yaml');
}

export interface NeverWriteList {
  schema_version: string;
  phrases: string[];
  framework_phrases: number;
  project_phrases: number;
}

export class NeverWriteListError extends Error {}

function parseList(text: string, source: string): string[] {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    throw new NeverWriteListError(`${source} is not valid YAML: ${(error as Error).message}`);
  }
  const record = (parsed ?? {}) as { schema_version?: unknown; phrases?: unknown };
  if (String(record.schema_version) !== NEVER_WRITE_SCHEMA_VERSION) {
    throw new NeverWriteListError(
      `${source} needs schema_version "${NEVER_WRITE_SCHEMA_VERSION}" (found ${String(record.schema_version)})`,
    );
  }
  const phrases = record.phrases ?? [];
  if (!Array.isArray(phrases) || phrases.some((phrase) => typeof phrase !== 'string')) {
    throw new NeverWriteListError(`${source} needs "phrases" to be a list of strings`);
  }
  return phrases.map((phrase: string) => phrase.trim()).filter((phrase) => phrase.length > 0);
}

function readProjectText(projectRoot: string): string | null {
  try {
    return readFileSync(join(projectRoot, PROJECT_NEVER_WRITE_PATH), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new NeverWriteListError(
      `could not read ${PROJECT_NEVER_WRITE_PATH}: ${(error as Error).message}`,
    );
  }
}

export function loadNeverWriteList(projectRoot?: string): NeverWriteList {
  const frameworkPath = frameworkNeverWritePath();
  const framework = parseList(readFileSync(frameworkPath, 'utf8'), frameworkPath);
  if (framework.length === 0) {
    throw new NeverWriteListError(`${frameworkPath} holds no phrases`);
  }
  const phrases = [...framework];
  const seen = new Set(framework.map((phrase) => phrase.toLowerCase()));
  const projectText = projectRoot === undefined ? null : readProjectText(projectRoot);
  const added = projectText === null ? [] : parseList(projectText, PROJECT_NEVER_WRITE_PATH);
  for (const phrase of added) {
    if (seen.has(phrase.toLowerCase())) continue;
    seen.add(phrase.toLowerCase());
    phrases.push(phrase);
  }
  return {
    schema_version: NEVER_WRITE_SCHEMA_VERSION,
    phrases,
    framework_phrases: framework.length,
    project_phrases: phrases.length - framework.length,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileNeverWritePattern(phrases: readonly string[]): RegExp {
  const alternatives = [...phrases]
    .sort((left, right) => right.length - left.length || (left < right ? -1 : 1))
    .map((phrase) => escapeRegExp(phrase).replace(/\s+/g, '\\s+'));
  return new RegExp(`\\b(?:${alternatives.join('|')})\\b`, 'giu');
}
