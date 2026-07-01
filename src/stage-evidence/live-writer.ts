// Live stage-evidence writer (RCA fix A). The production caller the recorder
// verbs never had: a Claude PreToolUse hook (runtime/hooks/stage-writer.mjs)
// calls `recordLiveStageEdit` on every Edit/Write/NotebookEdit, so per-stage
// `live-mark` rows are minted from an OBSERVABLE tool event — script-clock times
// and real-byte digests, never authored by the model (R2/R4/R5).
//
// Only file-mutating stages are observable here: `development` (source edits),
// `checks` (test edits), `documentation_sync` (doc edits), and `specification`
// when a spec/contract file is written. `planning` and `review` produce no file
// mutation, so they are NOT inferred from edits (that would be a false live-mark,
// the exact dishonesty the RCA calls out) — they arrive via `recordMarkedStage`,
// the shared seam the marker parser (fix B) calls.

import { isAbsolute, relative } from 'pathe';

import { currentOrdinal, readSessionUnit, type SessionLedgerRow } from '@/session-ledger/ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

import { endStage, openStageEvidence, startStage } from './recorder.js';
import { isKnownStage, stageIndex, type StageId } from './stages.js';
import { STAGE_EVIDENCE_DOC_TYPE } from './types.js';

/** Normalise a hook-supplied path to a project-relative posix path for globbing. */
function toRelativePosix(projectRoot: string, targetPath: string): string {
  const rel = isAbsolute(targetPath) ? relative(projectRoot, targetPath) : targetPath;
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Map a mutated file to the feature-development stage its edit evidences, or null
 * when the edit is not stage-bearing (config, lockfiles, framework-internal
 * `.paqad/**`). First-match-wins, ordered so the more specific arm wins: a
 * `*.test.ts` under `src/**` is `checks` (tests arm sits above development), and
 * `docs/instructions/**` is `specification` (the canonical contract) not
 * `documentation_sync`.
 */
export function classifyStage(targetPath: string, projectRoot = ''): StageId | null {
  const p = projectRoot ? toRelativePosix(projectRoot, targetPath) : targetPath.replace(/\\/g, '/');

  // Framework-internal / non-source: never record (the writer must not log itself).
  if (p.startsWith('.paqad/') || p === '' || p.startsWith('../')) return null;

  // checks — test files anywhere (above development so src tests classify here).
  if (
    p.startsWith('tests/') ||
    /(^|\/)__tests__\//.test(p) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)
  ) {
    return 'checks';
  }

  // specification — the canonical contract + explicit spec files.
  if (
    p.startsWith('docs/instructions/') ||
    p.startsWith('specs/') ||
    p.endsWith('.spec.md') ||
    /feature-spec/.test(p)
  ) {
    return 'specification';
  }

  // documentation_sync — other canonical docs + top-level doc files.
  if (
    /^README/i.test(p) ||
    /^CHANGELOG/i.test(p) ||
    p.startsWith('docs/') ||
    (/\.md$/.test(p) && !p.includes('/'))
  ) {
    return 'documentation_sync';
  }

  // development — source / build / runtime code.
  if (
    p.startsWith('src/') ||
    p.startsWith('lib/') ||
    p.startsWith('app/') ||
    p.startsWith('scripts/') ||
    p.startsWith('runtime/') ||
    /\/src\//.test(p) ||
    /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p)
  ) {
    return 'development';
  }

  return null;
}

/** Clock seam so the hook uses the wall clock and tests inject a fixed time. */
export interface LiveWriteInput {
  projectRoot: string;
  sessionId?: string | null;
  toolName: string;
  targetPath: string;
  now?: () => Date;
}

/** The highest canonical index among stages already started in this change. Exported
 *  so the narration predicate (narration.ts) reuses the SAME entry decision the writer
 *  makes, rather than re-deriving it and risking drift. */
export function highestStartedIndex(rows: readonly SessionLedgerRow[]): number {
  let highest = -1;
  for (const row of rows) {
    if (row.kind === 'stage_start' && typeof row.stage === 'string') {
      highest = Math.max(highest, stageIndex(row.stage));
    }
  }
  return highest;
}

/** The set of stage ids that carry a row of `kind` in this change. Exported for the
 *  narration predicate (see `highestStartedIndex`). */
export function stagesWithKind(rows: readonly SessionLedgerRow[], kind: string): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.kind === kind && typeof row.stage === 'string') set.add(row.stage);
  }
  return set;
}

/**
 * Record a stage transition for one mutating edit. Deterministic and best-effort:
 * classifies the target, opens the change once, ends any earlier still-open stage
 * when a later stage begins, then starts the new stage — all via the recorder
 * verbs (so timestamps/digests are script-minted). Never throws: an out-of-order
 * edit is left to the completion gate, and any recorder error is swallowed so the
 * host hook stays a non-blocking writer (always exits 0).
 */
export function recordLiveStageEdit(input: LiveWriteInput): StageId | null {
  const { projectRoot, targetPath, now } = input;
  const stage = classifyStage(targetPath, projectRoot);
  if (!stage) return null;

  try {
    const sessionId = resolveSessionId(projectRoot, input.sessionId);
    let ordinal = currentOrdinal(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId);
    if (ordinal <= 0) {
      ordinal = openStageEvidence(projectRoot, { sessionId, adapter: 'claude-code', now }).ordinal;
    }
    const ctx = { sessionId, ordinal, adapter: 'claude-code' as const, now };
    const rows = readSessionUnit(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId, ordinal);

    const started = stagesWithKind(rows, 'stage_start');
    const ended = stagesWithKind(rows, 'stage_end');
    if (started.has(stage)) return stage; // already recording this stage (idempotent)

    const targetIndex = stageIndex(stage);
    const highest = highestStartedIndex(rows);
    // Out of order (an earlier stage after a later one already began): leave the
    // ledger untouched — the completion gate reports the real ordering, not the writer.
    if (highest >= 0 && targetIndex < highest) return null;

    // Forward transition: close every earlier still-open stage, in order, before
    // opening the new one, so each started stage carries an ended_at (R5).
    for (const row of rows) {
      if (row.kind !== 'stage_start' || typeof row.stage !== 'string') continue;
      const s = row.stage;
      if (started.has(s) && !ended.has(s) && stageIndex(s) < targetIndex) {
        ended.add(s);
        try {
          endStage(projectRoot, s, {}, ctx);
        } catch {
          /* best-effort: a recorder throw never wedges the writer */
        }
      }
    }
    startStage(projectRoot, stage, ctx);
    return stage;
  } catch {
    // Best-effort: the writer is non-blocking. A resolution/IO error means no row,
    // never a thrown hook.
    return null;
  }
}

/** Phase of a marked (non-mutation) stage boundary. */
export type MarkedStagePhase = 'start' | 'end';

export interface MarkedStageInput {
  sessionId?: string | null;
  stage: string;
  phase: MarkedStagePhase;
  artifactPaths?: string[];
  /** Provider that emitted the marker (`claude-code`, `codex-cli`, `gemini-cli`).
   *  Recorded verbatim on the row so a cross-provider ledger attributes each stage
   *  to the host that actually ran it (issue #265). Defaults to `claude-code` for
   *  the original Claude Stop path that predates the arg. */
  adapter?: string;
  now?: () => Date;
}

/**
 * Record a stage boundary the marker parser (fix B) extracts from the agent's
 * `paqad:stage <name> <start|end>` control line. The ROW is script-minted (clock +
 * validation inside the recorder), so the model only supplies a bare boundary
 * token, never row content. This is the deterministic signal for the non-mutation
 * stages (planning, specification-as-thinking, review). Best-effort: a junk or
 * out-of-order marker records nothing rather than throwing.
 */
export function recordMarkedStage(projectRoot: string, input: MarkedStageInput): boolean {
  if (!isKnownStage(input.stage)) return false;
  const ctx = {
    sessionId: input.sessionId,
    adapter: input.adapter ?? 'claude-code',
    now: input.now,
  };
  try {
    if (input.phase === 'start') {
      startStage(projectRoot, input.stage, ctx);
    } else {
      endStage(projectRoot, input.stage, { artifactPaths: input.artifactPaths ?? [] }, ctx);
    }
    return true;
  } catch {
    return false;
  }
}
