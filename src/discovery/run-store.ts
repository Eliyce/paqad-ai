// Discovery run store (issue #597).
//
// Opens, reads, updates, lists, and resolves Discovery runs under `.paqad/ledger/delivery/`. The
// run.json is the run's identity + lifecycle record; it is stamped through the shared feature-
// evidence envelope (change key = the run ULID) and written atomically (temp + rename), so a
// mid-crash write never leaves a half-written record and a hand edit is detectable by content hash.
//
// This layer is workflow-state-agnostic: it takes an explicit run dir name (or a ref to resolve).
// Which run a SESSION is on is carried by the per-session workflow-state anchor (see boundary.ts),
// never by a repo-level pointer — so no session ever borrows another's active run (DW-10, INV-5).

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
  /** Deterministic ULID seam for tests. */
  ulid?: string;
  ulidSeed?: number;
  now?: () => Date;
}

export interface OpenedDiscoveryRun {
  dirName: string;
  record: DiscoveryRunRecord;
}

/**
 * Build a `run.json` record (envelope + body). `recorded_at` is pinned to `stampAt` so the identity
 * time is the writer's clock (open → opened_at; update → updated_at), never a re-read drift.
 */
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

/**
 * Open a new Discovery run: mint the dir name, seed `run.json` with status `active`, revision 1,
 * and no outcome. The owning session is stamped into the envelope; every later update keeps it.
 */
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

/** Tolerant read of a run's `run.json`, or null when absent/corrupt. */
export function readDiscoveryRun(projectRoot: string, dirName: string): DiscoveryRunRecord | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectRoot, discoveryRunFilePath(dirName, 'run')), 'utf8'),
    ) as unknown;
    if (isRunRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Absent / unreadable / malformed.
  }
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
  /** Bump the revision (a material change that invalidates dependent evidence). */
  bumpRevision?: boolean;
  now?: () => Date;
}

/**
 * Patch a run's lifecycle fields, re-stamping `run.json` (a new `updated_at` and a fresh identity
 * hash). The owning session and `opened_at` are preserved. Returns the updated record, or null when
 * the run cannot be read (nothing is written in that case).
 */
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

/** Every well-formed Discovery run dir name under the root, sorted (ULID-ascending = chronological). */
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

/**
 * Resolve a run ref (an exact dir name, a bare ULID, or a slug) to its dir name, or null when no
 * run matches. An ambiguous slug resolves to the most recent (last, ULID-ascending) match. This
 * never guesses "the latest run" from a bare empty ref — an empty ref returns null (DW-12).
 */
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
  const bySlug = runs.filter((dir) => parseDiscoveryRunDirName(dir)?.slug === trimmed);
  return bySlug.length > 0 ? bySlug[bySlug.length - 1]! : null;
}
