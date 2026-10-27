import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { writeFileAtomic } from '@/hud/files.js';

import type { Finding } from './execute.js';

export const FILE_RESULTS_VERSION = 1;

export interface FileResultEntry {
  script: string;
  script_sha256: string;
  file: string;
  file_sha256: string;
  findings: Finding[];
}

export interface FileResultsCache {
  lookup(script: string, scriptSha: string, file: string): Finding[] | undefined;
  store(script: string, scriptSha: string, file: string, findings: Finding[]): void;
  save(): void;
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function entryKey(script: string, file: string): string {
  return `${script}\n${file}`;
}

function isFinding(value: unknown): value is Finding {
  const finding = value as Partial<Finding> | null;
  return (
    typeof finding === 'object' &&
    finding !== null &&
    typeof finding.file === 'string' &&
    typeof finding.message === 'string' &&
    typeof finding.severity === 'string'
  );
}

function isEntry(value: unknown): value is FileResultEntry {
  const entry = value as Partial<FileResultEntry> | null;
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.script === 'string' &&
    typeof entry.script_sha256 === 'string' &&
    typeof entry.file === 'string' &&
    typeof entry.file_sha256 === 'string' &&
    Array.isArray(entry.findings) &&
    entry.findings.every(isFinding)
  );
}

export function fileResultsPath(projectRoot: string): string {
  return join(projectRoot, PATHS.RULE_SCRIPTS_FILE_RESULTS);
}

export function readFileResults(projectRoot: string): Map<string, FileResultEntry> {
  const entries = new Map<string, FileResultEntry>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(fileResultsPath(projectRoot), 'utf8'));
  } catch {
    return entries;
  }
  const doc = parsed as { version?: unknown; entries?: unknown } | null;
  if (doc?.version !== FILE_RESULTS_VERSION || !Array.isArray(doc.entries)) {
    return entries;
  }
  for (const entry of doc.entries) {
    if (isEntry(entry)) entries.set(entryKey(entry.script, entry.file), entry);
  }
  return entries;
}

export function openFileResultsCache(projectRoot: string): FileResultsCache {
  const entries = readFileResults(projectRoot);
  const fileShas = new Map<string, string | null>();

  const fileSha = (file: string): string | null => {
    if (!fileShas.has(file)) {
      let sha: string | null;
      try {
        sha = sha256Text(readFileSync(join(projectRoot, file), 'utf8'));
      } catch {
        sha = null;
      }
      fileShas.set(file, sha);
    }
    return fileShas.get(file) ?? null;
  };

  const keep = (entry: FileResultEntry): boolean =>
    fileSha(entry.script) === entry.script_sha256 && fileSha(entry.file) === entry.file_sha256;

  return {
    lookup(script, scriptSha, file) {
      const entry = entries.get(entryKey(script, file));
      const sha = fileSha(file);
      if (!entry || sha === null) return undefined;
      return entry.script_sha256 === scriptSha && entry.file_sha256 === sha
        ? entry.findings
        : undefined;
    },
    store(script, scriptSha, file, findings) {
      const sha = fileSha(file);
      if (sha === null) return;
      entries.set(entryKey(script, file), {
        script,
        script_sha256: scriptSha,
        file,
        file_sha256: sha,
        findings,
      });
    },
    save() {
      const kept = [...entries.values()]
        .filter(keep)
        .sort((a, b) => entryKey(a.script, a.file).localeCompare(entryKey(b.script, b.file)));
      writeFileAtomic(
        fileResultsPath(projectRoot),
        `${JSON.stringify({ version: FILE_RESULTS_VERSION, entries: kept })}\n`,
      );
    },
  };
}
