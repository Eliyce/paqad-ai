/**
 * Codebase memory tier (RAG buildout F21).
 *
 * A deterministic, file-backed memory of durable repository facts that survives
 * across sessions: things learned about the repo (where a subsystem lives, a
 * naming convention), decisions taken, recurring failures to avoid, and house
 * style. It is injected at session start via the same session-context seam the
 * rules (F5) and retrieval (F11) slices ride, as a `## Codebase memory` section.
 *
 * Hard constraints (FEATURES.md) honoured here:
 *   - Deterministic-first. Memory is a plain keyed store, never an embedding-RAG
 *     guess. Recall is exact: every stored fact is surfaced (within budget), so a
 *     learned fact is never silently dropped.
 *   - Save tokens. The section is token-budgeted ({@link MEMORY_SECTION_CHAR_BUDGET})
 *     and capped at {@link MAX_MEMORY_ENTRIES}; only the freshest facts are injected.
 *   - Complement, never block. Reads are best-effort and never throw; a missing or
 *     malformed store yields an empty section, so the agent proceeds exactly as today.
 *   - Honest / no confidently-wrong stale hits. Facts supersede by `(kind, key)`:
 *     re-recording the same key EVOLVES the existing entry in place rather than
 *     appending a duplicate, so the store never accumulates contradictory copies.
 *     The section is framed as advisory — re-verify against the live code.
 *
 * Storage lives at {@link PATHS.CODEBASE_MEMORY} (a single JSON file under the
 * already git-ignored `.paqad/crs/` root, disjoint from the desktop's PQD-415 CRS
 * collection subdirectories). It is per-machine and regenerable; team-shared
 * memory is the separate cross-provider effort (#236), deliberately out of scope.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from '@/background/atomic-artifact.js';
import { PATHS } from '@/core/constants/paths.js';

/** The kinds of durable fact the codebase memory holds. */
export type MemoryKind = 'repo-fact' | 'decision' | 'recurring-failure' | 'style';

/** Every kind, in the order they are grouped in the injected section. */
export const MEMORY_KINDS: readonly MemoryKind[] = [
  'repo-fact',
  'decision',
  'recurring-failure',
  'style',
] as const;

/** Human heading for each kind in the `## Codebase memory` section. */
const KIND_HEADINGS: Record<MemoryKind, string> = {
  'repo-fact': 'Repo facts',
  decision: 'Decisions',
  'recurring-failure': 'Recurring failures to avoid',
  style: 'House style',
};

/** A single durable memory. `key` is the supersede axis within a `kind`. */
export interface CodebaseMemoryEntry {
  /** Stable opaque id (`${kind}:${key}`), used only for addressing. */
  id: string;
  kind: MemoryKind;
  /** The fact's identity within its kind; re-recording the same key evolves it. */
  key: string;
  /** The fact itself, one or two sentences. */
  text: string;
  /** ISO timestamp of the last write (freshest entries are injected first). */
  updated_at: string;
  /** Optional file/path provenance for the fact. */
  sources?: string[];
}

/** The on-disk store: a version tag plus the keyed entries. */
export interface CodebaseMemoryStore {
  version: 1;
  entries: CodebaseMemoryEntry[];
}

/** The write-side shape callers hand {@link recordCodebaseMemory}. */
export interface MemoryInput {
  kind: MemoryKind;
  key: string;
  text: string;
  sources?: string[];
}

/** An empty store (the cold-start / disabled value). */
export function emptyMemoryStore(): CodebaseMemoryStore {
  return { version: 1, entries: [] };
}

/** Total character ceiling for the injected section (a token guard, not a quality bar). */
export const MEMORY_SECTION_CHAR_BUDGET = 2000;

/** Hard cap on entries injected, independent of the char budget. */
export const MAX_MEMORY_ENTRIES = 20;

/** Composite identity of an entry within the store. */
function compositeId(kind: MemoryKind, key: string): string {
  return `${kind}:${key}`;
}

/** Absolute path to the codebase-memory store for a project. */
export function memoryStorePath(projectRoot: string): string {
  return join(projectRoot, PATHS.CODEBASE_MEMORY);
}

/**
 * Read the store, best-effort. A missing file, unreadable file, malformed JSON, or
 * a payload that is not a recognised store all yield an empty store — never a throw,
 * so a corrupt memory file degrades to "no memory", exactly like today's behaviour.
 */
export function loadCodebaseMemory(projectRoot: string): CodebaseMemoryStore {
  let raw: string;
  try {
    raw = readFileSync(memoryStorePath(projectRoot), 'utf8');
  } catch {
    return emptyMemoryStore();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return emptyMemoryStore();
    }
    const entries = (parsed as { entries: unknown[] }).entries.filter(isMemoryEntry);
    return { version: 1, entries };
  } catch {
    return emptyMemoryStore();
  }
}

/** Structural guard for a stored entry (drops anything that lost its shape on disk). */
function isMemoryEntry(value: unknown): value is CodebaseMemoryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.kind === 'string' &&
    (MEMORY_KINDS as readonly string[]).includes(entry.kind) &&
    typeof entry.key === 'string' &&
    entry.key.length > 0 &&
    typeof entry.text === 'string' &&
    typeof entry.updated_at === 'string'
  );
}

/**
 * Upsert an entry into a store, PURELY (returns a new store; the input is untouched).
 * If an entry with the same `(kind, key)` already exists it is EVOLVED in place —
 * its text/sources/timestamp are replaced and its position is preserved — so the
 * store never holds two contradictory copies of the same fact. A new key is appended.
 */
export function upsertMemoryEntry(
  store: CodebaseMemoryStore,
  input: MemoryInput,
  now: string,
): CodebaseMemoryStore {
  const id = compositeId(input.kind, input.key);
  const next: CodebaseMemoryEntry = {
    id,
    kind: input.kind,
    key: input.key,
    text: input.text.trim(),
    updated_at: now,
    ...(input.sources && input.sources.length > 0 ? { sources: input.sources } : {}),
  };
  const entries = [...store.entries];
  const existing = entries.findIndex((entry) => entry.id === id);
  if (existing >= 0) {
    entries[existing] = next;
  } else {
    entries.push(next);
  }
  return { version: 1, entries };
}

/** Atomic-write the store to disk (via the F1 atomic-artifact swap). */
export async function writeCodebaseMemory(
  projectRoot: string,
  store: CodebaseMemoryStore,
): Promise<void> {
  await atomicWriteFile(memoryStorePath(projectRoot), `${JSON.stringify(store, null, 2)}\n`);
}

/**
 * Record (learn or evolve) a single fact: load → upsert by `(kind, key)` → write.
 * This is the API a workflow uses to teach the codebase something; the next session
 * recalls it through {@link composeMemorySection}. Returns the updated store.
 */
export async function recordCodebaseMemory(
  projectRoot: string,
  input: MemoryInput,
  now: string = new Date().toISOString(),
): Promise<CodebaseMemoryStore> {
  const updated = upsertMemoryEntry(loadCodebaseMemory(projectRoot), input, now);
  await writeCodebaseMemory(projectRoot, updated);
  return updated;
}

/** Freshest first (by `updated_at`), tie-broken by id for a stable order. */
function byRecency(a: CodebaseMemoryEntry, b: CodebaseMemoryEntry): number {
  if (a.updated_at !== b.updated_at) {
    return a.updated_at < b.updated_at ? 1 : -1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function formatEntryLine(entry: CodebaseMemoryEntry): string {
  const source = entry.sources && entry.sources.length > 0 ? ` (${entry.sources.join(', ')})` : '';
  return `- ${entry.text}${source}`;
}

export interface ComposeMemoryOptions {
  /** Total character ceiling. Defaults to {@link MEMORY_SECTION_CHAR_BUDGET}. */
  charBudget?: number;
  /** Max entries injected. Defaults to {@link MAX_MEMORY_ENTRIES}. */
  maxEntries?: number;
}

/**
 * Compose the `## Codebase memory` slice of the session-context artifact. Returns
 * `''` when there is nothing to inject so the caller can append it unconditionally
 * without changing the rule/retrieval output. The freshest entries are selected
 * first, capped at `maxEntries` and trimmed to `charBudget`, then grouped by kind.
 *
 * The section is framed as ADVISORY durable context — the model is told these are
 * remembered facts to weigh, re-verified against the live code, never ground truth.
 */
export function composeMemorySection(
  entries: readonly CodebaseMemoryEntry[],
  options: ComposeMemoryOptions = {},
): string {
  const charBudget = options.charBudget ?? MEMORY_SECTION_CHAR_BUDGET;
  const maxEntries = options.maxEntries ?? MAX_MEMORY_ENTRIES;
  if (entries.length === 0 || maxEntries <= 0 || charBudget <= 0) {
    return '';
  }

  // Freshest first, capped by count, then trimmed to the char budget by accumulated
  // line length so the budget is a hard ceiling on what reaches the model.
  const ranked = [...entries].sort(byRecency).slice(0, maxEntries);
  const selected: CodebaseMemoryEntry[] = [];
  let used = 0;
  for (const entry of ranked) {
    const lineLen = formatEntryLine(entry).length + 1;
    if (selected.length > 0 && used + lineLen > charBudget) {
      break;
    }
    selected.push(entry);
    used += lineLen;
  }
  if (selected.length === 0) {
    return '';
  }

  // Group the selected entries by kind, preserving the recency order within a group.
  const groups: string[] = [];
  for (const kind of MEMORY_KINDS) {
    const ofKind = selected.filter((entry) => entry.kind === kind);
    if (ofKind.length === 0) {
      continue;
    }
    const lines = ofKind.map(formatEntryLine).join('\n');
    groups.push(`### ${KIND_HEADINGS[kind]}\n${lines}`);
  }

  const noun = selected.length === 1 ? 'fact' : 'facts';
  return (
    `## Codebase memory — ${selected.length} remembered ${noun}\n` +
    `> Durable facts learned in past sessions. Advisory, not ground truth — re-verify against the live code.\n\n` +
    `${groups.join('\n\n')}\n`
  );
}

/**
 * Gather the codebase-memory section for the current project. Best-effort: returns
 * `''` on any failure (missing/corrupt store), so the artifact stays rule/retrieval-
 * only and disabled/cold-start equals today. Never throws.
 */
export function gatherCodebaseMemory(
  projectRoot: string,
  options: ComposeMemoryOptions = {},
): string {
  try {
    return composeMemorySection(loadCodebaseMemory(projectRoot).entries, options);
  } catch {
    return '';
  }
}
