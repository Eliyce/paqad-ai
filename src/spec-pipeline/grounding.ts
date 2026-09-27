// S0 grounding (issue #512, FR-2; RAG-on path #520, FR-2.1; vocabulary #558, FR-3).
//
// Assemble the business vocabulary and rules relevant to the touched area BEFORE anything is
// judged — clarity is relative to what the project already documents (FR-3.1). There are two
// paths and grounding records which it took (FR-2.1):
//   - RAG-on (`groundAreaAsync`, path `rag`): when `rag_enabled` is on, terms + references are
//     drawn from the framework's EXISTING semantic retrieval seam (`gatherWorkingSetSlices`).
//     The pipeline owns no cache and no reader — retrieval and its cache belong to the seam
//     (FR-2.4 / FR-8.5).
//   - docs-fallback (`groundArea`, path `docs-fallback`): reads the relevant `docs/modules/**`
//     (the framework's canonical per-module business docs). This is the honest default and the
//     fallback when RAG is off or retrieval returns nothing.
// Either path records REFERENCES plus the vocabulary TERMS S1/S2 ground on — pointers, never
// copies (FR-2.2) — and, since #558, a structured `vocabulary` of the project's own words with
// their kind and source. Both paths run the SAME extraction over the SAME file bodies they read,
// so the two paths are output-identical for the same content (AC-6). Grounding never blocks: a
// thin or undocumented area still succeeds and is marked `sparse` (FR-2.3). Zero model tokens.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { PATHS } from '@/core/constants/paths.js';
import { normalizeIntelligenceConfig } from '@/core/project-intelligence.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { gatherWorkingSetSlices } from '@/context/retrieval-context.js';
import type { RetrievalSource } from '@/context/retrieval-context.js';

import type { GroundingArtifact, GroundingReference, VocabularyEntry } from './types.js';

export interface GroundOptions {
  /** Module slugs to scope grounding to; when omitted, top-level modules are scanned. */
  modules?: string[];
  /** Max doc files to read (bounded for speed — NFR-1 < 2s). */
  maxFiles?: number;
  /** Fewer than this many terms ⇒ the area is `sparse`. */
  sparseFloor?: number;
}

/** Options for the RAG-aware {@link groundAreaAsync} (#520). Extends the docs-glob options. */
export interface GroundAsyncOptions extends GroundOptions {
  /**
   * Override the `rag_enabled` resolution (tests). When omitted it is read from the project
   * profile via the same `readProjectProfile` + `normalizeIntelligenceConfig` seam retrieval
   * uses, so grounding and retrieval agree on whether RAG is on.
   */
  ragEnabled?: boolean;
  /**
   * Retrieval query seed for the RAG path. When omitted a query is derived from the module
   * slugs; the working-set paths (change evidence) ride along regardless.
   */
  query?: string;
  /** Override the working-set paths handed to retrieval (defaults to live change evidence). */
  changedPaths?: readonly string[];
  /**
   * Retrieval source seam — defaults to the framework's real `RagService` inside
   * {@link gatherWorkingSetSlices}. Injectable so tests can stub retrieval without an index.
   */
  service?: RetrievalSource;
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_SPARSE_FLOOR = 3;

/**
 * Scaffold headings that carry no vocabulary — dropped from `terms` (FR-3.3). Compared
 * case-insensitively against a heading's normalised text.
 */
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

/** The scaffold placeholder line in an unfilled `## Glossary` — treated as an empty glossary. */
const GLOSSARY_SCAFFOLD_LINE = 'define terms a stakeholder might not know';

/** A bold span is junk unless it is a single line of a sane length (FR-3.3). */
function isSaneBold(term: string): boolean {
  return !term.includes('\n') && term.trim().length >= 3 && term.trim().length <= 60;
}

/**
 * Pull heading texts and bold glossary spans from a markdown doc as vocabulary terms. Scaffold
 * headings and malformed bold spans are dropped (FR-3.3) so the S1/S2 lens is not fed junk.
 */
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

/** The `## <heading>` a line opens, normalised to lower-case, or null when it is not a heading. */
function sectionHeading(line: string): string | null {
  const m = /^#{2,6}\s+(.*\S)\s*$/.exec(line);
  return m ? m[1]!.trim().toLowerCase() : null;
}

/** Parse a `## Glossary` bullet in any of the four documented forms (FR-3.2). */
function parseGlossaryBullet(line: string): { term: string; definition?: string } | null {
  // - **Term**: def  |  - **Term** - def  |  - **Term** — def
  const bold = /^\s*[-*]\s+\*\*([^*\n]+)\*\*\s*(?::|[-—])\s*(.+?)\s*$/.exec(line);
  if (bold) return { term: bold[1]!.trim(), definition: bold[2]!.trim() };
  // - Term: def   (no bold)
  const plain = /^\s*[-*]\s+([^*:]+?):\s+(.+?)\s*$/.exec(line);
  if (plain) return { term: plain[1]!.trim(), definition: plain[2]!.trim() };
  return null;
}

/** The bold lead of a bullet or line (`- **Term** …` / `**Term** …`), when sane. */
function boldLead(line: string): string | null {
  const m = /^\s*(?:[-*]\s+)?\*\*([^*\n]+)\*\*/.exec(line);
  if (!m) return null;
  const term = m[1]!.trim();
  return isSaneBold(term) ? term : null;
}

/** All inline backticked names on a line. */
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

/** Extract vocabulary from one `business.md` body (FR-3.2). */
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

/** Extract vocabulary from one `technical.md` body (FR-3.2). */
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

/** Dispatch vocabulary extraction on a doc's filename (FR-3.2). */
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

/** Extract every `**Term**` entry from `.paqad/glossary.md` when present (FR-3.2). */
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

/** Deduplicate vocabulary entries by kind+term, keeping first (and its definition). */
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

/**
 * Ground the touched area from the project's docs. Deterministic and model-free. Returns
 * references (pointers to the docs read) + terms (the documented vocabulary) + a `sparse`
 * flag. Never throws and never blocks — a missing docs tree yields an empty, sparse result.
 */
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
    /* v8 ignore next 3 -- a glob fault degrades to empty/sparse, never a throw. */
  } catch {
    files = [];
  }

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

/** Classify a retrieved slice's source file: a rule doc vs any other project doc. */
function referenceKindFor(sourceFile: string): GroundingReference['kind'] {
  return /(^|\/)rules?\//.test(sourceFile.replace(/\\/g, '/')) ? 'rule' : 'doc';
}

/**
 * Ground the touched area, RAG-aware (#520, FR-2.1). When `rag_enabled` is on, terms and
 * references come from the framework's existing semantic retrieval seam
 * ({@link gatherWorkingSetSlices}) — the pipeline builds no cache and no reader of its own
 * (FR-2.4 / FR-8.5). When RAG is off, or retrieval yields no terms, it delegates to the
 * synchronous docs-glob {@link groundArea}. Either way the artifact records which `path` was
 * taken (FR-2.1). Never throws and never blocks: any retrieval fault degrades to the fallback.
 */
export async function groundAreaAsync(
  projectRoot: string,
  options: GroundAsyncOptions = {},
): Promise<GroundingArtifact> {
  const ragEnabled =
    options.ragEnabled ??
    normalizeIntelligenceConfig(readProjectProfile(projectRoot)?.intelligence).rag_enabled;

  if (ragEnabled) {
    const rag = await groundViaRetrieval(projectRoot, options);
    // Only trust the RAG path when it actually produced vocabulary; otherwise fall back so a
    // cold/empty index still grounds from the docs (FR-2.3) rather than returning nothing.
    if (rag && rag.terms.length > 0) return rag;
  }

  return groundArea(projectRoot, options);
}

/**
 * The RAG branch of {@link groundAreaAsync}: retrieve through the existing seam and map the
 * slices to grounding terms + references + vocabulary. Returns `null` when retrieval yields no
 * slices, so the caller falls back to the docs glob. Never throws.
 */
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
    // Reuse the framework retrieval seam (owns the RagService + cache). Scope to docs — the
    // business vocabulary and rules grounding needs — and pass an explicit topN so the depth
    // gate never skips this call.
    ({ slices } = await gatherWorkingSetSlices(projectRoot, {
      scope: 'docs',
      topN: maxFiles,
      ...(query ? { query } : {}),
      ...(options.changedPaths ? { changedPaths: options.changedPaths } : {}),
      ...(options.service ? { service: options.service } : {}),
    }));
    /* v8 ignore next 4 -- gatherWorkingSetSlices never throws today; belt-and-braces fallback. */
  } catch {
    return null;
  }

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
