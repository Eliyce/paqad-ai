import { readFileSync } from 'node:fs';
import { join } from 'pathe';

import { documentHashMatches, rowHashMatches } from '@/feature-evidence/envelope.js';

import { discoveryRunChangeKey, discoveryRunDir } from './paths.js';
import { readDiscoveryRun } from './run-store.js';

export type DiscoveryValidationReason =
  | 'ok'
  | 'wrong-path'
  | 'missing'
  | 'malformed'
  | 'foreign-run'
  | 'foreign-owner'
  | 'stale'
  | 'wrong-artifact';

export interface DiscoveryValidationResult {
  ok: boolean;
  reason: DiscoveryValidationReason;
  detail: string;
}

function fail(reason: DiscoveryValidationReason, detail: string): DiscoveryValidationResult {
  return { ok: false, reason, detail };
}

export function validateDiscoveryArtifact(
  projectRoot: string,
  dirName: string,
  sessionId: string,
  artifactRelPath: string,
  expectedDocType?: string,
): DiscoveryValidationResult {
  const runDir = discoveryRunDir(dirName);
  const normalized = artifactRelPath.replace(/\\/g, '/');
  if (normalized !== runDir && !normalized.startsWith(`${runDir}/`)) {
    return fail('wrong-path', `artifact ${artifactRelPath} is outside the run dir ${runDir}`);
  }

  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, artifactRelPath), 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? fail('missing', `artifact ${artifactRelPath} does not exist`)
      : fail('malformed', `artifact ${artifactRelPath} is not readable`);
  }

  let doc: Record<string, unknown>;
  let hashOk: boolean | null;
  if (normalized.endsWith('.jsonl')) {
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length === 0) {
      return fail('malformed', `artifact ${artifactRelPath} has no rows`);
    }
    const rows: Record<string, unknown>[] = [];
    for (const line of lines) {
      try {
        const row: unknown = JSON.parse(line);
        if (typeof row !== 'object' || row === null || Array.isArray(row)) {
          return fail('malformed', `artifact ${artifactRelPath} has a non-object row`);
        }
        rows.push(row as Record<string, unknown>);
      } catch {
        return fail('malformed', `artifact ${artifactRelPath} has a non-JSON row`);
      }
    }
    doc = rows[0]!;
    hashOk = rows.every((row) => rowHashMatches(row) !== false);
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail('malformed', `artifact ${artifactRelPath} is not readable JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail('malformed', `artifact ${artifactRelPath} is not a JSON object`);
    }
    doc = parsed as Record<string, unknown>;
    hashOk = documentHashMatches(doc);
  }

  const runChange = discoveryRunChangeKey(dirName);
  if (doc.change !== runChange) {
    return fail(
      'foreign-run',
      `artifact names run ${String(doc.change)}, not this run ${runChange}`,
    );
  }

  const owner = readDiscoveryRun(projectRoot, dirName)?.session_id ?? null;
  if (owner === null || doc.session_id !== owner || sessionId !== owner) {
    return fail(
      'foreign-owner',
      owner === null
        ? `the run owner cannot be established (run.json missing or unreadable)`
        : `artifact/session is not the run owner (${owner}); an ownership transfer is required`,
    );
  }

  if (expectedDocType !== undefined && doc.doc_type !== expectedDocType) {
    return fail(
      'wrong-artifact',
      `artifact is ${String(doc.doc_type)}, not the expected ${expectedDocType}`,
    );
  }

  if (hashOk === false) {
    return fail('stale', `artifact ${artifactRelPath} was edited outside a writer (hash mismatch)`);
  }

  return { ok: true, reason: 'ok', detail: 'artifact is valid' };
}
