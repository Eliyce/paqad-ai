// S0 grounding (issue #512, FR-2).
//
// Assemble the business vocabulary and rules relevant to the touched area BEFORE anything is
// judged — clarity is relative to what the project already documents (FR-3.1). This is the
// RAG-off fallback path: it reads the relevant `docs/modules/**` (the framework's canonical
// per-module business docs) and records REFERENCES plus the vocabulary TERMS S1/S2 ground on
// — pointers, never copies (FR-2.2). It builds no cache and no reader of its own beyond a
// bounded doc glob (FR-2.4 / FR-8.5); when RAG is enabled the caller can widen `terms` from
// retrieval, but the honest default is grep over the docs. Grounding never blocks: a thin or
// undocumented area still succeeds and is marked `sparse` so downstream flags rather than
// assumes (FR-2.3). Zero model tokens.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import fg from 'fast-glob';

import type { GroundingArtifact, GroundingReference } from './types.js';

export interface GroundOptions {
  /** Module slugs to scope grounding to; when omitted, top-level modules are scanned. */
  modules?: string[];
  /** Max doc files to read (bounded for speed — NFR-1 < 2s). */
  maxFiles?: number;
  /** Fewer than this many terms ⇒ the area is `sparse`. */
  sparseFloor?: number;
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

  let files: string[] = [];
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
  return { references, terms, sparse };
}
