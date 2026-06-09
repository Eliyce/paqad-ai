/**
 * FR-DP3: Defect Pattern Store
 *
 * File-based store at ~/.paqad/defect-patterns/ (parallel to the solution
 * pattern library at ~/.paqad/patterns/).
 *
 * Layout:
 *   ~/.paqad/defect-patterns/
 *     index.json           – lightweight metadata per pattern
 *     entries/{id}.json    – full pattern entry
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { engineLog } from '@/core/logger-registry.js';
import { DEFECT_PATTERN_SCHEMA_VERSION } from './types.js';
import type {
  DefectFinding,
  DefectPatternEntry,
  DefectPatternIndex,
  DefectPatternIndexEntry,
  StackContext,
} from './types.js';

const EXAMPLE_CAP = 5;
const STALENESS_DAYS = 365;

export function defaultStoreRoot(): string {
  return path.join(os.homedir(), '.paqad', 'defect-patterns');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Record a batch of findings into the store. Creates or updates pattern entries. */
export async function recordFindings(
  findings: DefectFinding[],
  storeRoot = defaultStoreRoot(),
): Promise<void> {
  if (findings.length === 0) return;
  await ensureStoreDir(storeRoot);
  const index = await loadIndex(storeRoot);

  for (const finding of findings) {
    await upsertPattern(finding, index, storeRoot);
  }

  index.updated_at = new Date().toISOString();
  await saveIndex(index, storeRoot);
}

/** Query patterns relevant to a given stack context. */
export async function queryPatterns(
  options: {
    stack_context?: StackContext;
    min_frequency?: number;
    max_age_days?: number;
    limit?: number;
  },
  storeRoot = defaultStoreRoot(),
): Promise<DefectPatternEntry[]> {
  const index = await loadIndex(storeRoot);
  const minFrequency = options.min_frequency ?? 3;
  const maxAgeDays = options.max_age_days ?? STALENESS_DAYS;
  const limit = options.limit ?? 5;
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  const candidates = index.entries.filter((entry) => {
    if (entry.frequency < minFrequency) return false;
    if (new Date(entry.last_seen) < cutoff) return false;
    if (entry.stale) return false;
    return true;
  });

  const filtered: DefectPatternEntry[] = [];
  for (const candidate of candidates) {
    const entry = await loadEntry(candidate.pattern_id, storeRoot);
    if (!entry) continue;
    if (options.stack_context && !stackMatches(entry.stack_contexts, options.stack_context)) {
      continue;
    }
    filtered.push(entry);
  }

  return filtered.sort((a, b) => b.frequency - a.frequency).slice(0, limit);
}

/** Remove patterns last seen more than `olderThanDays` days ago. */
export async function prunePatterns(
  olderThanDays: number,
  storeRoot = defaultStoreRoot(),
): Promise<number> {
  const index = await loadIndex(storeRoot);
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const toRemove = index.entries.filter((e) => new Date(e.last_seen) < cutoff);

  for (const entry of toRemove) {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(entryPath(entry.pattern_id, storeRoot));
    } catch {
      // best-effort; entry file may already be missing
    }
  }

  index.entries = index.entries.filter((e) => new Date(e.last_seen) >= cutoff);
  index.updated_at = new Date().toISOString();
  await saveIndex(index, storeRoot);
  return toRemove.length;
}

/** Load the full index, rebuilding from entry files if it is corrupt. */
export async function loadIndex(storeRoot = defaultStoreRoot()): Promise<DefectPatternIndex> {
  const indexFile = path.join(storeRoot, 'index.json');
  try {
    const raw = await readFile(indexFile, 'utf8');
    const parsed = JSON.parse(raw) as DefectPatternIndex;
    if (typeof parsed.schema_version !== 'number' || !Array.isArray(parsed.entries)) {
      throw new Error('invalid index structure');
    }
    return parsed;
  } catch {
    // Corrupt or missing — rebuild from entry files (EC-DP3).
    return rebuildIndex(storeRoot);
  }
}

/** Load a single pattern entry by ID. Returns null if it does not exist or is corrupt. */
export async function loadEntry(
  patternId: string,
  storeRoot = defaultStoreRoot(),
): Promise<DefectPatternEntry | null> {
  try {
    const raw = await readFile(entryPath(patternId, storeRoot), 'utf8');
    return JSON.parse(raw) as DefectPatternEntry;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function entryPath(patternId: string, storeRoot: string): string {
  return path.join(storeRoot, 'entries', `${patternId}.json`);
}

export async function ensureStoreDir(storeRoot: string): Promise<void> {
  await mkdir(path.join(storeRoot, 'entries'), { recursive: true });
}

async function saveIndex(index: DefectPatternIndex, storeRoot: string): Promise<void> {
  await ensureStoreDir(storeRoot);
  await writeFile(
    path.join(storeRoot, 'index.json'),
    JSON.stringify(index, null, 2) + '\n',
    'utf8',
  );
}

async function saveEntry(entry: DefectPatternEntry, storeRoot: string): Promise<void> {
  await ensureStoreDir(storeRoot);
  await writeFile(
    entryPath(entry.pattern_id, storeRoot),
    JSON.stringify(entry, null, 2) + '\n',
    'utf8',
  );
}

async function rebuildIndex(storeRoot: string): Promise<DefectPatternIndex> {
  const entriesDir = path.join(storeRoot, 'entries');
  let files: string[] = [];
  try {
    files = await readdir(entriesDir);
  } catch {
    // No entries directory yet
  }

  const entries: DefectPatternIndexEntry[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const id = file.replace(/\.json$/, '');
    try {
      const raw = await readFile(path.join(entriesDir, file), 'utf8');
      const entry = JSON.parse(raw) as DefectPatternEntry;
      entries.push({
        pattern_id: entry.pattern_id,
        subcategory: entry.subcategory,
        frequency: entry.frequency,
        last_seen: entry.last_seen,
        stale: entry.stale,
      });
    } catch {
      engineLog('warn', `[defect-patterns] Skipping corrupt entry file: ${id}.json`);
    }
  }

  return {
    schema_version: DEFECT_PATTERN_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
    entries,
  };
}

async function upsertPattern(
  finding: DefectFinding,
  index: DefectPatternIndex,
  storeRoot: string,
): Promise<void> {
  const existing = index.entries.find((e) => e.subcategory === finding.subcategory);

  if (existing) {
    const entry = await loadEntry(existing.pattern_id, storeRoot);
    if (!entry) return;
    applyFindingToEntry(finding, entry);
    existing.frequency = entry.frequency;
    existing.last_seen = entry.last_seen;
    existing.stale = entry.stale;
    await saveEntry(entry, storeRoot);
  } else {
    const entry = createEntryFromFinding(finding);
    index.entries.push({
      pattern_id: entry.pattern_id,
      subcategory: entry.subcategory,
      frequency: entry.frequency,
      last_seen: entry.last_seen,
      stale: entry.stale,
    });
    await saveEntry(entry, storeRoot);
  }
}

function createEntryFromFinding(finding: DefectFinding): DefectPatternEntry {
  const now = finding.recorded_at;
  return {
    pattern_id: generatePatternId(finding.subcategory),
    subcategory: finding.subcategory,
    description: finding.description,
    frequency: 1,
    recency: now,
    stack_contexts: [finding.stack_context],
    example_obligations: finding.obligation_id ? [finding.description] : [],
    example_files: finding.file_path ? [finding.file_path] : [],
    severity_distribution: { critical: 0, major: 0, minor: 0, info: 0 },
    first_seen: now,
    last_seen: now,
    stale: false,
  };
}

function applyFindingToEntry(finding: DefectFinding, entry: DefectPatternEntry): void {
  entry.frequency += 1;
  entry.last_seen = finding.recorded_at;
  entry.recency = finding.recorded_at;
  entry.stale = false;

  // Merge stack context if not already present
  if (
    !entry.stack_contexts.some(
      (sc) =>
        JSON.stringify(sc.frameworks.slice().sort()) ===
        JSON.stringify(finding.stack_context.frameworks.slice().sort()),
    )
  ) {
    entry.stack_contexts.push(finding.stack_context);
  }

  // Cap examples at 5
  if (finding.description && entry.example_obligations.length < EXAMPLE_CAP) {
    if (!entry.example_obligations.includes(finding.description)) {
      entry.example_obligations.push(finding.description);
    }
  }
  if (finding.file_path && entry.example_files.length < EXAMPLE_CAP) {
    if (!entry.example_files.includes(finding.file_path)) {
      entry.example_files.push(finding.file_path);
    }
  }
}

function stackMatches(stored: StackContext[], query: StackContext): boolean {
  if (query.frameworks.length === 0 && query.traits.length === 0) return true;
  return stored.some(
    (sc) =>
      query.frameworks.some((f) => sc.frameworks.includes(f)) ||
      query.traits.some((t) => sc.traits.includes(t)),
  );
}

function generatePatternId(subcategory: string): string {
  const slug = subcategory
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug}-${Date.now().toString(36)}`;
}

/** Mark patterns older than STALENESS_DAYS as stale without removing them. */
export function markStaleEntries(index: DefectPatternIndex): void {
  const cutoff = new Date(Date.now() - STALENESS_DAYS * 24 * 60 * 60 * 1000);
  for (const entry of index.entries) {
    entry.stale = new Date(entry.last_seen) < cutoff;
  }
}
