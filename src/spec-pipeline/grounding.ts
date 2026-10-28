import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import { normalizeIntelligenceConfig } from '@/core/project-intelligence.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { gatherWorkingSetSlices } from '@/context/retrieval-context.js';
import type { RetrievalSource } from '@/context/retrieval-context.js';
import { getProjectSecret } from '@/rag/secrets.js';
import { FileVectorIndex } from '@/rag/vector-index.js';

import { DEFAULT_GROUNDING_BUDGET_MS } from './config.js';

import type { GroundingArtifact, GroundingReference, VocabularyEntry } from './types.js';

export interface GroundOptions {
  modules?: string[];
  maxFiles?: number;
  sparseFloor?: number;
}

export interface GroundAsyncOptions extends GroundOptions {
  ragEnabled?: boolean;
  query?: string;
  changedPaths?: readonly string[];
  service?: RetrievalSource;
  budgetMs?: number;
}

export const GROUNDING_FALLBACK_REASONS = {
  ragDisabled: 'rag-disabled',
  missingKey: 'missing-embedding-key',
  coldIndex: 'cold-index',
  budget: 'budget-exceeded',
  noResults: 'no-retrieval-results',
} as const;

export function requestDigest(request: string): string {
  return `sha256:${createHash('sha256').update(request).digest('hex')}`;
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_SPARSE_FLOOR = 3;

const SCAFFOLD_HEADINGS = new Set<string>(
  [
    'Overview',
    'Purpose',
    'Summary',
    'Features',
    'Boundaries',
    'Authority',
    'Related',
    'Sources',
    'Source Footprint',
    'How to Update These Docs',
    'User Roles',
    'User Flows',
    'Business Rules',
    'Triggers and Side Effects',
    'Triggers & Side Effects',
    'Error States',
    'Glossary',
    'Module Boundaries',
    'Database Schema',
    'API Endpoints',
    'Models and Relationships',
    'State Management',
    'Error Codes',
    'Dependencies',
    'Configuration',
    'Testing Entry Points',
  ].map((h) => h.toLowerCase()),
);

const GLOSSARY_SCAFFOLD_LINE = 'define terms a stakeholder might not know';

function isSaneBold(term: string): boolean {
  return !term.includes('\n') && term.trim().length >= 3 && term.trim().length <= 60;
}

export function termsFromMarkdown(markdown: string): string[] {
  const terms: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      const text = heading[1]!.trim();
      if (!SCAFFOLD_HEADINGS.has(text.toLowerCase())) terms.push(text);
    }
  }
  for (const m of markdown.matchAll(/\*\*([^*]+)\*\*/g)) {
    const term = m[1]!.trim();
    if (isSaneBold(term)) terms.push(term);
  }
  return terms;
}

function sectionHeading(line: string): string | null {
  const m = /^#{2,6}\s+(.*\S)\s*$/.exec(line);
  return m ? m[1]!.trim().toLowerCase() : null;
}

function parseGlossaryBullet(line: string): { term: string; definition?: string } | null {
  const bold = /^\s*[-*]\s+\*\*([^*\n]+)\*\*\s*(?::|[-—])\s*(.+?)\s*$/.exec(line);
  if (bold) return { term: bold[1]!.trim(), definition: bold[2]!.trim() };
  const plain = /^\s*[-*]\s+([^*:]+?):\s+(.+?)\s*$/.exec(line);
  if (plain) return { term: plain[1]!.trim(), definition: plain[2]!.trim() };
  return null;
}

function boldLead(line: string): string | null {
  const m = /^\s*(?:[-*]\s+)?\*\*([^*\n]+)\*\*/.exec(line);
  if (!m) return null;
  const term = m[1]!.trim();
  return isSaneBold(term) ? term : null;
}

function backtickedNames(line: string): string[] {
  const names: string[] = [];
  for (const m of line.matchAll(/`([^`]+)`/g)) {
    const name = m[1]!.trim();
    if (name.length >= 2 && name.length <= 60) names.push(name);
  }
  return names;
}

const BUSINESS_SECTION_KINDS: Record<string, VocabularyEntry['kind']> = {
  'user roles': 'role',
  'user flows': 'flow',
  'business rules': 'rule',
};

const TECHNICAL_SECTIONS = new Set([
  'database schema',
  'api endpoints',
  'models and relationships',
  'configuration',
  'module boundaries',
]);

function extractBusinessVocabulary(source: string, content: string): VocabularyEntry[] {
  const out: VocabularyEntry[] = [];
  const seen = new Set<string>();
  let section = '';
  const push = (term: string, kind: VocabularyEntry['kind'], definition?: string): void => {
    const key = `${kind}:${term.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(definition ? { term, definition, kind, source } : { term, kind, source });
  };
  for (const line of content.split(/\r?\n/)) {
    const heading = sectionHeading(line);
    if (heading !== null) {
      section = heading;
      continue;
    }
    if (section === 'glossary') {
      const g = parseGlossaryBullet(line);
      if (g && g.term.toLowerCase() !== GLOSSARY_SCAFFOLD_LINE && isSaneBold(g.term)) {
        push(g.term, 'glossary', g.definition);
      }
      continue;
    }
    const businessKind = BUSINESS_SECTION_KINDS[section];
    if (businessKind) {
      const lead = boldLead(line);
      if (lead) push(lead, businessKind);
    }
  }
  return out;
}

function extractTechnicalVocabulary(source: string, content: string): VocabularyEntry[] {
  const out: VocabularyEntry[] = [];
  const seen = new Set<string>();
  let section = '';
  const push = (term: string): void => {
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ term, kind: 'technical', source });
  };
  for (const line of content.split(/\r?\n/)) {
    const heading = sectionHeading(line);
    if (heading !== null) {
      section = heading;
      continue;
    }
    if (!TECHNICAL_SECTIONS.has(section)) continue;
    for (const name of backtickedNames(line)) push(name);
    const lead = boldLead(line);
    if (lead) push(lead);
  }
  return out;
}

export function extractVocabulary(source: string, content: string): VocabularyEntry[] {
  const posix = source.replace(/\\/g, '/');
  if (posix.endsWith('/business.md') || posix === 'business.md') {
    return extractBusinessVocabulary(source, content);
  }
  if (posix.endsWith('/technical.md') || posix === 'technical.md') {
    return extractTechnicalVocabulary(source, content);
  }
  return [];
}

export function readGlossaryFile(
  projectRoot: string,
): { reference: GroundingReference; vocabulary: VocabularyEntry[] } | null {
  const rel = PATHS.GLOSSARY;
  let content: string;
  try {
    if (!existsSync(join(projectRoot, rel))) return null;
    content = readFileSync(join(projectRoot, rel), 'utf8');
  } catch {
    return null;
  }
  const vocabulary: VocabularyEntry[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    const term = m[1]!.trim();
    if (!isSaneBold(term)) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    vocabulary.push({ term, kind: 'glossary', source: rel });
  }
  return { reference: { kind: 'glossary', ref: rel }, vocabulary };
}

function dedupeVocabulary(entries: VocabularyEntry[]): VocabularyEntry[] {
  const seen = new Set<string>();
  const out: VocabularyEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.term.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

export function groundArea(projectRoot: string, options: GroundOptions = {}): GroundingArtifact {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const sparseFloor = options.sparseFloor ?? DEFAULT_SPARSE_FLOOR;

  const patterns =
    options.modules && options.modules.length > 0
      ? options.modules.map((m) => `docs/modules/${m}/**/*.md`)
      : ['docs/modules/**/*.md'];

  let files: string[];
  try {
    files = fg
      .sync(patterns, { cwd: projectRoot, onlyFiles: true, dot: false })
      .sort()
      .slice(0, maxFiles);
    /* v8 ignore start -- a glob fault degrades to empty/sparse, never a throw. */
  } catch {
    files = [];
  }
  /* v8 ignore stop */

  const references: GroundingReference[] = [];
  const termSet = new Set<string>();
  const vocabulary: VocabularyEntry[] = [];
  for (const rel of files) {
    let content: string;
    try {
      content = readFileSync(join(projectRoot, rel), 'utf8');
    } catch {
      continue;
    }
    references.push({ kind: 'doc', ref: rel });
    for (const term of termsFromMarkdown(content)) {
      if (term.length > 0) termSet.add(term);
    }
    vocabulary.push(...extractVocabulary(rel, content));
  }

  const glossary = readGlossaryFile(projectRoot);
  if (glossary) {
    references.push(glossary.reference);
    vocabulary.push(...glossary.vocabulary);
  }

  const terms = [...termSet].sort();
  const sparse = terms.length < sparseFloor;
  return {
    references,
    terms,
    sparse,
    path: 'docs-fallback',
    vocabulary: dedupeVocabulary(vocabulary),
  };
}

function referenceKindFor(sourceFile: string): GroundingReference['kind'] {
  return /(^|\/)rules?\//.test(sourceFile.replace(/\\/g, '/')) ? 'rule' : 'doc';
}

function lexicalFallback(
  projectRoot: string,
  options: GroundOptions,
  reason: string,
): GroundingArtifact {
  return { ...groundArea(projectRoot, options), mode: 'lexical-fallback', fallback_reason: reason };
}

async function indexIsWarm(projectRoot: string): Promise<boolean> {
  if (!existsSync(join(projectRoot, PATHS.CHUNK_INDEX))) return false;
  try {
    const status = await new FileVectorIndex().status(projectRoot);
    return status.present && !status.corrupt && (status.meta?.chunk_count ?? 0) > 0;
  } catch {
    return false;
  }
}

async function projectIndexBlocker(projectRoot: string): Promise<string | null> {
  const intelligence = normalizeIntelligenceConfig(readProjectProfile(projectRoot)?.intelligence);
  if (
    intelligence.embedding_provider === 'openai' &&
    !getProjectSecret(projectRoot, 'OPENAI_API_KEY')
  ) {
    return GROUNDING_FALLBACK_REASONS.missingKey;
  }
  return (await indexIsWarm(projectRoot)) ? null : GROUNDING_FALLBACK_REASONS.coldIndex;
}

const BUDGET_SPENT = Symbol('budget-spent');

async function withinBudget<T>(
  work: Promise<T>,
  budgetMs: number,
): Promise<T | typeof BUDGET_SPENT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const spent = new Promise<typeof BUDGET_SPENT>((resolve) => {
    timer = setTimeout(() => resolve(BUDGET_SPENT), budgetMs);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, spent]);
  } finally {
    clearTimeout(timer);
  }
}

export async function groundAreaAsync(
  projectRoot: string,
  options: GroundAsyncOptions = {},
): Promise<GroundingArtifact> {
  const ragEnabled =
    options.ragEnabled ??
    normalizeIntelligenceConfig(readProjectProfile(projectRoot)?.intelligence).rag_enabled;
  if (!ragEnabled) {
    return lexicalFallback(projectRoot, options, GROUNDING_FALLBACK_REASONS.ragDisabled);
  }

  const blocker = options.service ? null : await projectIndexBlocker(projectRoot);
  if (blocker) return lexicalFallback(projectRoot, options, blocker);

  const rag = await withinBudget(
    groundViaRetrieval(projectRoot, options),
    options.budgetMs ?? DEFAULT_GROUNDING_BUDGET_MS,
  );
  if (rag === BUDGET_SPENT) {
    return lexicalFallback(projectRoot, options, GROUNDING_FALLBACK_REASONS.budget);
  }
  if (rag && rag.terms.length > 0) return { ...rag, mode: 'retrieval' };
  return lexicalFallback(projectRoot, options, GROUNDING_FALLBACK_REASONS.noResults);
}

async function groundViaRetrieval(
  projectRoot: string,
  options: GroundAsyncOptions,
): Promise<GroundingArtifact | null> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const sparseFloor = options.sparseFloor ?? DEFAULT_SPARSE_FLOOR;
  const modules = options.modules ?? [];
  const query =
    options.query ??
    (modules.length > 0 ? `Business vocabulary and rules for: ${modules.join(', ')}` : undefined);

  let slices: Awaited<ReturnType<typeof gatherWorkingSetSlices>>['slices'];
  try {
    ({ slices } = await gatherWorkingSetSlices(projectRoot, {
      scope: 'docs',
      topN: maxFiles,
      skipSync: true,
      ...(query ? { query } : {}),
      ...(options.changedPaths ? { changedPaths: options.changedPaths } : {}),
      ...(options.service ? { service: options.service } : {}),
    }));
    /* v8 ignore start -- gatherWorkingSetSlices never throws today; belt-and-braces fallback. */
  } catch {
    return null;
  }
  /* v8 ignore stop */

  if (slices.length === 0) return null;

  const references: GroundingReference[] = [];
  const seenRefs = new Set<string>();
  const termSet = new Set<string>();
  const vocabulary: VocabularyEntry[] = [];
  for (const slice of slices) {
    if (!seenRefs.has(slice.source_file)) {
      seenRefs.add(slice.source_file);
      references.push({ kind: referenceKindFor(slice.source_file), ref: slice.source_file });
    }
    for (const term of termsFromMarkdown(slice.content)) {
      if (term.length > 0) termSet.add(term);
    }
    vocabulary.push(...extractVocabulary(slice.source_file, slice.content));
  }

  const glossary = readGlossaryFile(projectRoot);
  if (glossary) {
    references.push(glossary.reference);
    vocabulary.push(...glossary.vocabulary);
  }

  const terms = [...termSet].sort();
  const sparse = terms.length < sparseFloor;
  return { references, terms, sparse, path: 'rag', vocabulary: dedupeVocabulary(vocabulary) };
}
