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

import type { ClassificationScope, ClassificationWorkflow } from '@/core/types/classification.js';
import { normalizeIntelligenceConfig } from '@/core/project-intelligence.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { gateRetrieval } from '@/context/retrieval-depth-router.js';
import type { DepthRoutingInput } from '@/context/retrieval-depth-router.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { RagService } from '@/rag/service.js';
import type { RagRetrievalResult } from '@/rag/types.js';
import { recordRagEvidence } from '@/rag-ledger/recorder.js';

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

/**
 * Retrieval scope (RAG buildout F13). Docs first: the highest-ROI, safest content
 * and the biggest token win (today whole docs/modules can load ~20-40K; a handful
 * of slices is ~1-2K). Code retrieval is deliberately deferred to F19, after the
 * eval gate (F15) proves docs retrieval helps.
 *
 *   docs — only paqad doc/instruction/module-map slices (the F13 default).
 *   code — only non-doc (code) slices (the F19 extension surface).
 *   all  — everything (used by evals / explicit callers).
 */
export type RetrievalScope = 'docs' | 'code' | 'all';

/** Path prefixes that count as paqad documentation for the `docs` scope. */
export const DOC_SCOPE_PREFIXES = ['docs/instructions/', 'docs/modules/'] as const;

/**
 * Whether a source path is paqad documentation (docs/instructions, docs/modules, or
 * the module-map) and so belongs to the `docs` retrieval scope. Posix-normalised and
 * tolerant of a leading `./`.
 */
export function isDocScopedPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return (
    DOC_SCOPE_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    normalized.endsWith('module-map.yml')
  );
}

/**
 * Workflows that touch code and so should receive function-level code slices on top
 * of docs (RAG buildout F19). Feature-dev stages (plan / implement / verify) and the
 * other code-changing workflows route to scope `all`; documentation, writing, and
 * question workflows stay docs-only (F13). The chunks are already AST-node-level, so
 * "send a function, not a file" falls out of the existing chunker.
 */
const CODE_WORKFLOWS: ReadonlySet<ClassificationWorkflow> = new Set([
  'feature-development',
  'bug-fix',
  'refactor',
  'migration',
  'test-improvement',
  'architecture-change',
  'schema-change',
  'query-optimization',
  'root-cause-analysis',
  'cleanup',
  'investigation',
  'pentest',
  'pentest-retest',
]);

/**
 * Pick the retrieval scope for a workflow (RAG buildout F19). Code-changing workflows
 * get `all` (docs + function-level code slices); everything else, and the no-workflow
 * background default, stays docs-only — the safest content and the F13 default.
 */
export function scopeForWorkflow(workflow?: ClassificationWorkflow | null): RetrievalScope {
  return workflow && CODE_WORKFLOWS.has(workflow) ? 'all' : 'docs';
}

/** Keep only the slices that belong to `scope` (F13). `all` is a passthrough. */
export function filterToScope(
  slices: readonly RetrievalSlice[],
  scope: RetrievalScope,
): RetrievalSlice[] {
  if (scope === 'all') {
    return [...slices];
  }
  const wantDoc = scope === 'docs';
  return slices.filter((slice) => isDocScopedPath(slice.source_file) === wantDoc);
}

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
 * Consumer-side precision floor (RAG buildout F12). A confident-but-wrong slice is
 * worse than grep, so only slices with a known score at or above `floor` are kept;
 * a slice without a score is dropped (we never inject something we can't vouch for).
 * `RagService` already filters at the same `rag_similarity_threshold` during
 * retrieval; applying it again here makes the injection boundary self-defending —
 * any slice reaching the artifact is independently above the floor, regardless of
 * how it was retrieved.
 */
export function applyPrecisionFloor(
  slices: readonly RetrievalSlice[],
  floor: number,
): RetrievalSlice[] {
  return slices.filter((slice) => typeof slice.score === 'number' && slice.score >= floor);
}

/** Calibrated trust annotation — shows match strength so the model can weigh a slice. */
function formatScore(score?: number): string {
  if (typeof score !== 'number') {
    return '';
  }
  return ` · match ${Math.round(score * 100)}%`;
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
/**
 * Drop duplicate slices — same source file AND same chunk text — keeping the first
 * occurrence (highest-ranked, since retrieval returns best-first). Retrieval can surface
 * the same chunk more than once (overlapping windows, re-indexed content); injecting it
 * twice wastes budget and reads as bloat, so the assembled section carries each slice once.
 */
export function dedupeSlices(slices: readonly RetrievalSlice[]): RetrievalSlice[] {
  const seen = new Set<string>();
  const unique: RetrievalSlice[] = [];
  for (const slice of slices) {
    const key = `${slice.source_file} ${slice.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(slice);
  }
  return unique;
}

export function composeRetrievalSection(slices: readonly RetrievalSlice[]): string {
  if (slices.length === 0) {
    return '';
  }
  const capped = dedupeSlices(slices).slice(0, MAX_RETRIEVAL_SLICES);
  const blocks = capped
    .map(
      (slice) =>
        `### ${slice.source_file}${formatScore(slice.score)}\n\`\`\`\n${truncateSlice(
          slice.content,
        )}\n\`\`\``,
    )
    .join('\n\n');
  const noun = capped.length === 1 ? 'slice' : 'slices';
  return (
    `## Retrieved context — ${capped.length} ${noun} relevant to the files in play\n` +
    `> Advisory hints retrieved from the index, not ground truth. Re-read the live files before relying on them; the match % is the index's confidence, not correctness.\n\n` +
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
  /**
   * Override the injection precision floor (F12). Defaults to the project's
   * `rag_similarity_threshold` (0.75) — the single tuned, documented threshold.
   */
  precisionFloor?: number;
  /**
   * Retrieval scope (F13/F19). When unset, it is routed by `routing.workflow`:
   * code-changing workflows get `all` (docs + code), others stay docs-only. Set this
   * explicitly to force a scope.
   */
  scope?: RetrievalScope;
  /**
   * Stage classification signals (F14). When present, retrieval depth is gated by
   * stage: a self-contained stage skips retrieval entirely; a system-wide stage
   * pulls a deeper candidate pool. When absent, depth is derived from the working
   * set (a wider working set ⇒ deeper retrieval). An explicit `topN` overrides the
   * gate.
   */
  routing?: DepthRoutingInput;
  /**
   * RAG-evidence (#249): when set, record a `called` event for the retrieval query that
   * is actually issued (scope / top-n / candidate count). Off for evals/tests so they
   * never write the ledger; the live background worker passes it.
   */
  recordEvidence?: { sessionId?: string; adapter?: string };
  /**
   * Prompt-driven retrieval seed (issue #336, the deferred F11/F14/F26 path). When
   * set, the retrieval query is the user's PROMPT (the working-set paths ride along as
   * keywords) instead of being derived purely from the working set — so a question
   * with no changed files still retrieves. Absent ⇒ the working-set query, unchanged.
   */
  query?: string;
}

/**
 * Derive a classification scope from the working-set paths (F14). With no live
 * classification (the background worker never sees the prompt), the breadth of the
 * change is the honest signal: one file is single-file, one module single-module,
 * a few modules multi-module, many system-wide. A "module" is the first two path
 * segments (e.g. `src/context`).
 */
export function deriveScopeFromWorkingSet(paths: readonly string[]): ClassificationScope {
  if (paths.length <= 1) {
    return 'single-file';
  }
  const modules = new Set(
    paths.map((path) => path.replace(/\\/g, '/').split('/').slice(0, 2).join('/')),
  );
  if (modules.size <= 1) {
    return 'single-module';
  }
  if (modules.size <= 3) {
    return 'multi-module';
  }
  return 'system-wide';
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
  const promptQuery = options.query?.trim();
  // Nothing to retrieve for: no working set AND no prompt seed. A prompt-driven query
  // (#336) still retrieves when the working set is empty (e.g. a question).
  if (changedPaths.length === 0 && !promptQuery) {
    return [];
  }

  const intelligence = normalizeIntelligenceConfig(readProjectProfile(projectRoot)?.intelligence);

  // F14 — stage-aware gating. An explicit topN wins (test/eval hook); otherwise gate
  // depth by the stage (or, with no live classification, by the working-set breadth).
  // A self-contained stage skips retrieval entirely — no embed, no query.
  let effectiveTopN = options.topN;
  if (effectiveTopN === undefined) {
    const routing = options.routing ?? { scope: deriveScopeFromWorkingSet(changedPaths) };
    const gate = gateRetrieval({ ...routing, baseTopN: intelligence.rag_top_n });
    if (gate.skip) {
      return [];
    }
    effectiveTopN = gate.topN;
  }

  // #336 — a prompt seed makes the PROMPT the retrieval query (working-set paths ride
  // along as keywords); without it the query is the working set alone, as before.
  const retrievalInput = promptQuery
    ? { taskDescription: promptQuery, keywords: changedPaths.map((path) => basename(path)) }
    : buildWorkingSetQuery(changedPaths);

  const service = options.service ?? new RagService(projectRoot);
  let result: RagRetrievalResult;
  try {
    result = await service.retrieveForEval(retrievalInput, effectiveTopN);
  } catch {
    // Retrieval is an accelerator on top of grep; any failure falls back silently.
    return [];
  }

  const slices = result.retrieved_chunks.map((chunk) => ({
    source_file: chunk.source_file,
    content: chunk.content,
    score: result.vector_scores.get(chunk.id),
  }));

  // F12 — drop anything below the injection floor at the consumer boundary, so a
  // confident-but-wrong (or unscored) slice never reaches the model. Below floor ⇒
  // [] ⇒ empty section ⇒ the agent falls back to grep on the live files.
  const floor = options.precisionFloor ?? intelligence.rag_similarity_threshold;
  const aboveFloor = applyPrecisionFloor(slices, floor);

  // F13 + F19 — scope routing. An explicit scope wins; otherwise route by workflow:
  // code-changing stages (feature-dev plan/implement/verify, bug-fix, refactor, …) get
  // `all` (docs + function-level code slices, F19), while doc/writing/question stages
  // and the no-workflow background default stay docs-only (F13, the safest content).
  const scope = options.scope ?? scopeForWorkflow(options.routing?.workflow);

  // #249 — a retrieval query WAS issued: record the `called` event (scope / top-n /
  // candidate pool). Best-effort and opt-in (only the live worker passes recordEvidence).
  if (options.recordEvidence) {
    recordRagEvidence(
      projectRoot,
      'called',
      {
        query_scope: scope === 'all' ? 'all' : scope === 'code' ? 'code' : 'docs',
        top_n: effectiveTopN,
        candidates: result.retrieved_chunks.length,
      },
      {
        ragEnabled: true,
        adapter: options.recordEvidence.adapter ?? 'engine',
        sessionId: options.recordEvidence.sessionId,
      },
    );
  }

  return filterToScope(aboveFloor, scope);
}
