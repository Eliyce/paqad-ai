// S0 grounding (issue #512, FR-2; RAG-on path #520, FR-2.1).
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
// copies (FR-2.2). Grounding never blocks: a thin or undocumented area still succeeds and is
// marked `sparse` so downstream flags rather than assumes (FR-2.3). Zero model tokens (the RAG
// embeddings are the framework's existing cost, not a new model call in the pipeline).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import { normalizeIntelligenceConfig } from '@/core/project-intelligence.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { gatherWorkingSetSlices } from '@/context/retrieval-context.js';
import type { RetrievalSource } from '@/context/retrieval-context.js';

import type { GroundingArtifact, GroundingReference } from './types.js';

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

/** Pull heading texts and bold glossary spans from a markdown doc as vocabulary terms. */
function termsFromMarkdown(markdown: string): string[] {
  const terms: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (heading) {
      terms.push(heading[1]!.trim());
    }
  }
  for (const m of markdown.matchAll(/\*\*([^*]+)\*\*/g)) {
    terms.push(m[1]!.trim());
  }
  return terms;
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
  }

  const terms = [...termSet].sort();
  const sparse = terms.length < sparseFloor;
  return { references, terms, sparse, path: 'docs-fallback' };
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
 * slices to grounding terms + references. Returns `null` when retrieval yields no slices, so
 * the caller falls back to the docs glob. Never throws.
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
  for (const slice of slices) {
    if (!seenRefs.has(slice.source_file)) {
      seenRefs.add(slice.source_file);
      references.push({ kind: referenceKindFor(slice.source_file), ref: slice.source_file });
    }
    for (const term of termsFromMarkdown(slice.content)) {
      if (term.length > 0) termSet.add(term);
    }
  }

  const terms = [...termSet].sort();
  const sparse = terms.length < sparseFloor;
  return { references, terms, sparse, path: 'rag' };
}
