import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteFile } from '@/background/atomic-artifact.js';
import { PATHS } from '@/core/constants/paths.js';

export type MemoryKind = 'repo-fact' | 'decision' | 'recurring-failure' | 'style';

export const MEMORY_KINDS: readonly MemoryKind[] = [
  'repo-fact',
  'decision',
  'recurring-failure',
  'style',
] as const;

const KIND_HEADINGS: Record<MemoryKind, string> = {
  'repo-fact': 'Repo facts',
  decision: 'Decisions',
  'recurring-failure': 'Recurring failures to avoid',
  style: 'House style',
};

export interface CodebaseMemoryEntry {
  id: string;
  kind: MemoryKind;
  key: string;
  text: string;
  updated_at: string;
  sources?: string[];
}

export interface CodebaseMemoryStore {
  version: 1;
  entries: CodebaseMemoryEntry[];
}

export interface MemoryInput {
  kind: MemoryKind;
  key: string;
  text: string;
  sources?: string[];
}

export function emptyMemoryStore(): CodebaseMemoryStore {
  return { version: 1, entries: [] };
}

export const MEMORY_SECTION_CHAR_BUDGET = 2000;

export const MAX_MEMORY_ENTRIES = 20;

function compositeId(kind: MemoryKind, key: string): string {
  return `${kind}:${key}`;
}

export function memoryStorePath(projectRoot: string): string {
  return join(projectRoot, PATHS.CODEBASE_MEMORY);
}

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

export async function writeCodebaseMemory(
  projectRoot: string,
  store: CodebaseMemoryStore,
): Promise<void> {
  await atomicWriteFile(memoryStorePath(projectRoot), `${JSON.stringify(store, null, 2)}\n`);
}

export async function recordCodebaseMemory(
  projectRoot: string,
  input: MemoryInput,
  now: string = new Date().toISOString(),
): Promise<CodebaseMemoryStore> {
  const updated = upsertMemoryEntry(loadCodebaseMemory(projectRoot), input, now);
  await writeCodebaseMemory(projectRoot, updated);
  return updated;
}

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
  charBudget?: number;
  maxEntries?: number;
}

export function composeMemorySection(
  entries: readonly CodebaseMemoryEntry[],
  options: ComposeMemoryOptions = {},
): string {
  const charBudget = options.charBudget ?? MEMORY_SECTION_CHAR_BUDGET;
  const maxEntries = options.maxEntries ?? MAX_MEMORY_ENTRIES;
  if (entries.length === 0 || maxEntries <= 0 || charBudget <= 0) {
    return '';
  }

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
