/**
 * Retrieval consumer on the session-time seam (RAG buildout F11).
 *
 * Turns the built-but-unread vector index into something the model actually sees.
 * On the background refresh path, this gathers the top-k retrieved slices relevant
 * to the files in play and composes them into a `## Retrieved context` section that
 * is appended to the single session-context artifact (after the rule slice, F5).
 * The seam (F2) then injects the whole artifact on the next prompt.
 *
 * Hard constraints (FEATURES.md) honoured here:
 *   - Complement, never block. Gathering runs only in the detached background
 *     worker (the `rag refresh-context` CLI), never on the prompt path. The prompt
 *     path only reads the finished artifact via the seam.
 *   - Save tokens. We inject SLICES (chunks), not whole files, capped at
 *     {@link MAX_RETRIEVAL_SLICES} and per-slice truncated at {@link MAX_SLICE_CHARS}.
 *   - Disabled / cold-start == today. Every fallback inside `RagService.retrieve`
 *     (rag off, no index, stale index, below similarity threshold) returns no
 *     chunks, so {@link gatherWorkingSetSlices} returns `[]` and
 *     {@link composeRetrievalSection} emits nothing — the artifact stays rule-only,
 *     byte-identical to F5's output.
 *
 * The retrieval QUERY is the current working set (the files being changed), not the
 * user's prompt text: the artifact is PRECOMPUTED in the background (stale-while-
 * revalidate) and the worker never sees the prompt. This is the same working-tree-
 * driven model the rest of the buildout uses; prompt-driven retrieval is a later
 * refinement (F14 gates depth by stage; F26 adds a per-stage retrieval sub-agent).
 */
import { basename } from 'node:path';

import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { RagService } from '@/rag/service.js';
import type { RagRetrievalResult } from '@/rag/types.js';

/** A single retrieved slice destined for the session-context artifact. */
export interface RetrievalSlice {
  /** The source file the chunk came from (the slice label). */
  source_file: string;
  /** The chunk text (a slice, never a whole file). */
  content: string;
  /** Cosine similarity score for the hit, when known. */
  score?: number;
}

/** Hard cap on slices injected into the artifact (token guard, not a quality bar). */
export const MAX_RETRIEVAL_SLICES = 5;

/** Per-slice character ceiling; a longer chunk is truncated with a visible marker. */
export const MAX_SLICE_CHARS = 1200;

function truncateSlice(content: string): string {
  const body = content.trim();
  if (body.length <= MAX_SLICE_CHARS) {
    return body;
  }
  return `${body.slice(0, MAX_SLICE_CHARS)}\n…[slice truncated at ${MAX_SLICE_CHARS} chars]`;
}

/**
 * Compose the retrieval slice of the session-context artifact. Returns `''` when
 * there is nothing to inject (no slices) so the caller can append it unconditionally
 * without changing the rule-only output. Slices are capped at
 * {@link MAX_RETRIEVAL_SLICES} and each body is truncated at {@link MAX_SLICE_CHARS}.
 *
 * The section is framed as ADVISORY — the model is told to verify against the live
 * files before relying on a slice. F12 adds the similarity floor that keeps a
 * confident-but-wrong chunk out of here in the first place.
 */
export function composeRetrievalSection(slices: readonly RetrievalSlice[]): string {
  if (slices.length === 0) {
    return '';
  }
  const capped = slices.slice(0, MAX_RETRIEVAL_SLICES);
  const blocks = capped
    .map((slice) => `### ${slice.source_file}\n\`\`\`\n${truncateSlice(slice.content)}\n\`\`\``)
    .join('\n\n');
  const noun = capped.length === 1 ? 'slice' : 'slices';
  return (
    `## Retrieved context — ${capped.length} ${noun} relevant to the files in play\n` +
    `> Advisory hints retrieved from the index. Re-read the live files before relying on them.\n\n` +
    `${blocks}\n`
  );
}

/** The retrieval surface {@link gatherWorkingSetSlices} needs — injectable for tests. */
export interface RetrievalSource {
  retrieveForEval(
    input: {
      taskDescription?: string;
      keywords: string[];
      targetFilePath?: string;
      symbolReferences?: string[];
    },
    topN?: number,
  ): Promise<RagRetrievalResult>;
}

export interface GatherOptions {
  /** Retrieval source; defaults to a fresh {@link RagService} for the project. */
  service?: RetrievalSource;
  /** Override the working-set paths (defaults to live change evidence). */
  changedPaths?: readonly string[];
  /** Override the top-k cap passed to retrieval. */
  topN?: number;
}

/**
 * Build the retrieval query from the working set. The changed file paths and their
 * basenames seed the query toward the code/docs related to what is being touched.
 */
function buildWorkingSetQuery(changedPaths: readonly string[]): {
  taskDescription: string;
  keywords: string[];
} {
  return {
    taskDescription: `Context for work in progress on: ${changedPaths.join(', ')}`,
    keywords: changedPaths.map((path) => basename(path)),
  };
}

/**
 * Gather the top-k retrieved slices for the current working set. Returns `[]` when
 * there is nothing in play or when retrieval falls back (rag disabled, no/stale
 * index, below similarity threshold, or any error) — so the artifact stays rule-only
 * and disabled/cold-start equals today. Never throws.
 */
export async function gatherWorkingSetSlices(
  projectRoot: string,
  options: GatherOptions = {},
): Promise<RetrievalSlice[]> {
  const changedPaths = options.changedPaths ?? (await loadChangeEvidence(projectRoot)).files;
  if (changedPaths.length === 0) {
    return [];
  }

  const service = options.service ?? new RagService(projectRoot);
  let result: RagRetrievalResult;
  try {
    result = await service.retrieveForEval(buildWorkingSetQuery(changedPaths), options.topN);
  } catch {
    // Retrieval is an accelerator on top of grep; any failure falls back silently.
    return [];
  }

  return result.retrieved_chunks.map((chunk) => ({
    source_file: chunk.source_file,
    content: chunk.content,
    score: result.vector_scores.get(chunk.id),
  }));
}
