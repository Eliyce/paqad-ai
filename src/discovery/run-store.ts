import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { buildDocumentEnvelope } from '@/feature-evidence/envelope.js';

import { mintDiscoveryRunDirName } from './mint.js';
import {
  discoveryDir,
  discoveryRunChangeKey,
  discoveryRunFilePath,
  parseDiscoveryRunDirName,
} from './paths.js';
import type { DiscoveryRunBody, DiscoveryRunRecord } from './records.js';
import { DISCOVERY_DOC_TYPES, DISCOVERY_SCHEMA_VERSION } from './types.js';
import type { DiscoveryOutcome, DiscoveryRunStatus } from './types.js';

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
}

export interface OpenDiscoveryRunInput {
  sessionId: string;
  title: string;
  issue?: string | null;
  adapter: string;
  ulid?: string;
  ulidSeed?: number;
  now?: () => Date;
}

export interface OpenedDiscoveryRun {
  dirName: string;
  record: DiscoveryRunRecord;
}

function buildRunRecord(
  change: string,
  sessionId: string,
  body: DiscoveryRunBody,
  stampAt: string,
): DiscoveryRunRecord {
  return buildDocumentEnvelope({
    docType: DISCOVERY_DOC_TYPES.run,
    change,
    sessionId,
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    now: () => new Date(stampAt),
    body: { ...body },
  }) as DiscoveryRunRecord;
}

export function openDiscoveryRun(
  projectRoot: string,
  input: OpenDiscoveryRunInput,
): OpenedDiscoveryRun {
  const minted = mintDiscoveryRunDirName({
    title: input.title,
    issue: input.issue,
    ulid: input.ulid,
    ulidSeed: input.ulidSeed,
  });
  const openedAt = (input.now ?? (() => new Date()))().toISOString();
  const body: DiscoveryRunBody = {
    workflow: 'discovery',
    title: input.title,
    slug: minted.slug,
    issue: minted.issue,
    revision: 1,
    status: 'active',
    outcome: null,
    adapter: input.adapter,
    opened_at: openedAt,
    updated_at: openedAt,
  };
  const record = buildRunRecord(minted.ulid, input.sessionId, body, openedAt);
  atomicWriteJson(join(projectRoot, discoveryRunFilePath(minted.dirName, 'run')), record);
  return { dirName: minted.dirName, record };
}

export function readDiscoveryRun(projectRoot: string, dirName: string): DiscoveryRunRecord | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectRoot, discoveryRunFilePath(dirName, 'run')), 'utf8'),
    ) as unknown;
    if (isRunRecord(parsed)) {
      return parsed;
    }
  } catch {}
  return null;
}

function isRunRecord(value: unknown): value is DiscoveryRunRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.doc_type === DISCOVERY_DOC_TYPES.run &&
    record.workflow === 'discovery' &&
    typeof record.session_id === 'string' &&
    typeof record.change === 'string'
  );
}

export interface UpdateDiscoveryRunPatch {
  status?: DiscoveryRunStatus;
  outcome?: DiscoveryOutcome | null;
  bumpRevision?: boolean;
  now?: () => Date;
}

export function updateDiscoveryRun(
  projectRoot: string,
  dirName: string,
  patch: UpdateDiscoveryRunPatch,
): DiscoveryRunRecord | null {
  const current = readDiscoveryRun(projectRoot, dirName);
  if (current === null) {
    return null;
  }
  const updatedAt = (patch.now ?? (() => new Date()))().toISOString();
  const body: DiscoveryRunBody = {
    workflow: 'discovery',
    title: current.title,
    slug: current.slug,
    issue: current.issue,
    revision: current.revision + (patch.bumpRevision ? 1 : 0),
    status: patch.status ?? current.status,
    outcome: patch.outcome === undefined ? current.outcome : patch.outcome,
    adapter: current.adapter,
    opened_at: current.opened_at,
    updated_at: updatedAt,
  };
  const record = buildRunRecord(current.change, current.session_id, body, updatedAt);
  atomicWriteJson(join(projectRoot, discoveryRunFilePath(dirName, 'run')), record);
  return record;
}

export function listDiscoveryRuns(projectRoot: string): string[] {
  try {
    return readdirSync(join(projectRoot, discoveryDir()), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && parseDiscoveryRunDirName(entry.name) !== null)
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function resolveDiscoveryRunDir(projectRoot: string, ref: string): string | null {
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const runs = listDiscoveryRuns(projectRoot);
  if (runs.includes(trimmed)) {
    return trimmed;
  }
  const byUlid = runs.filter((dir) => discoveryRunChangeKey(dir) === trimmed);
  if (byUlid.length > 0) {
    return byUlid[byUlid.length - 1]!;
  }
  const bySlug = runs.filter((dir) => {
    if (parseDiscoveryRunDirName(dir)?.slug === trimmed) {
      return true;
    }
    return readDiscoveryRun(projectRoot, dir)?.slug === trimmed;
  });
  return bySlug.length > 0 ? bySlug[bySlug.length - 1]! : null;
}
