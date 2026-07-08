// Stage-evidence recorder (issue #247). Script-only — the LLM never hand-authors a
// row; it calls these verbs (open / start / end) through the thin CLI. Unlike the
// RAG recorder (hot path, best-effort/swallow), these are explicit agent calls, so
// an out-of-order start or a validation failure THROWS — the CLI surfaces it as a
// non-zero exit the agent must act on. Timestamps and digests are minted inside the
// script (the script clock + real on-disk bytes), never supplied by the LLM.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  appendSessionEvent,
  currentOrdinal,
  openSessionDoc,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import { validateStageEvidenceRow } from './schema.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { isKnownStage } from './stages.js';
import {
  STAGE_EVIDENCE_DOC_TYPE,
  STAGE_EVIDENCE_SCHEMA_VERSION,
  type StageEvidenceRow,
} from './types.js';

export interface StageEvidenceContext {
  /** Host session id (Claude hook stdin); resolved/minted when absent. */
  sessionId?: string | null;
  /** Change ordinal to attach to; resolved from the `.open` pointer when absent. */
  ordinal?: number;
  /** Provider adapter (claude-code, codex-cli, …). */
  adapter: string;
  lane?: 'fast' | 'graduated' | 'full' | null;
  /** Clock seam for tests. */
  now?: () => Date;
}

const APPEND_OPTS = (now?: () => Date) => ({
  schemaVersion: STAGE_EVIDENCE_SCHEMA_VERSION,
  validate: (row: SessionLedgerRow) => validateStageEvidenceRow(row),
  now,
});

export function changeKey(sessionId: string, ordinal: number): string {
  return `${sessionId}#${ordinal}`;
}

/**
 * Open a new code-change record for the session and return its ordinal (the
 * 1-based Nth change this session). Called as the FIRST action of any code change.
 */
export function openStageEvidence(
  projectRoot: string,
  ctx: StageEvidenceContext,
): { sessionId: string; ordinal: number; changeKey: string } {
  const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
  const { ordinal } = openSessionDoc(
    projectRoot,
    STAGE_EVIDENCE_DOC_TYPE,
    sessionId,
    { adapter: ctx.adapter, lane: ctx.lane ?? null },
    APPEND_OPTS(ctx.now),
  );
  return { sessionId, ordinal, changeKey: changeKey(sessionId, ordinal) };
}

/** Resolve the change ordinal to write to: explicit, else the current open one. */
function resolveOrdinal(projectRoot: string, sessionId: string, ctx: StageEvidenceContext): number {
  if (ctx.ordinal && ctx.ordinal > 0) {
    return ctx.ordinal;
  }
  const current = currentOrdinal(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId);
  if (current > 0) {
    return current;
  }
  // No record open — auto-open one so a stage call never lands on nothing.
  return openStageEvidence(projectRoot, ctx).ordinal;
}

/**
 * Record the START of a stage. Rejects only an UNKNOWN stage. It no longer rejects an
 * out-of-order boundary (issue #310): forbidding an earlier stage after a later one
 * had already started made the pre-code stages (planning/specification) unrecordable
 * once a later stage was recorded — the deadlock — with no way to clear the gate. The
 * gate must always be clearable, so a start is always recorded; ordering is judged
 * (non-destructively) by the fold's `computeOrderingViolations` at completion, which
 * remains the single source of the ordering verdict. Re-starting the SAME stage is a
 * redo and is allowed. The script stamps `started_at` (`ts`).
 */
export function startStage(
  projectRoot: string,
  stage: string,
  ctx: StageEvidenceContext,
): StageEvidenceRow {
  if (!isKnownStage(stage)) {
    throw new Error(`Unknown stage "${stage}" — not in the feature-development registry.`);
  }
  const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
  const ordinal = resolveOrdinal(projectRoot, sessionId, ctx);
  return append(projectRoot, sessionId, ordinal, ctx, {
    kind: 'stage_start',
    stage,
    event_status: 'started',
    evidence_source: 'live-mark',
  });
}

export interface EndStageInput {
  /** Project-relative artifact paths the stage produced. */
  artifactPaths?: string[];
  /** Explicit git working-tree delta digest for development; else derived. */
  subjectDigest?: string | null;
  note?: string | null;
}

/**
 * Record the END of a stage. Stat+hashes the artifacts over their real on-disk
 * bytes (the script, not the LLM) into `artifact_digest`, sets `subject_digest` on
 * development, and stamps `ended_at` (`ts`). `duration_ms` is derived at fold time.
 */
export function endStage(
  projectRoot: string,
  stage: string,
  input: EndStageInput,
  ctx: StageEvidenceContext,
): StageEvidenceRow {
  if (!isKnownStage(stage)) {
    throw new Error(`Unknown stage "${stage}" — not in the feature-development registry.`);
  }
  const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
  const ordinal = resolveOrdinal(projectRoot, sessionId, ctx);
  const artifactPaths = input.artifactPaths ?? [];
  const artifactDigest =
    artifactPaths.length > 0 ? hashArtifacts(projectRoot, artifactPaths) : null;
  const subjectDigest =
    stage === 'development'
      ? (input.subjectDigest ?? artifactDigest)
      : (input.subjectDigest ?? null);
  return append(projectRoot, sessionId, ordinal, ctx, {
    kind: 'stage_end',
    stage,
    event_status: 'completed',
    evidence_source: 'live-mark',
    artifact_paths: artifactPaths.length > 0 ? artifactPaths : null,
    artifact_digest: artifactDigest,
    subject_digest: subjectDigest,
    note: input.note ?? null,
  });
}

/**
 * SHA-256 over the real on-disk bytes of each artifact, folded order-independently.
 * Returns `null` when NO referenced file yields real, non-empty bytes (all absent or
 * empty) — so a stage that names a missing or empty artifact cannot masquerade as
 * proven (issue #320). A missing/empty file still contributes a deterministic marker
 * (`:absent` / `:empty`) to a mixed digest, so tampering with one of several real
 * artifacts is still detected.
 */
function hashArtifacts(projectRoot: string, artifactPaths: readonly string[]): string | null {
  let anyReal = false;
  const perFile = [...artifactPaths].sort().map((rel) => {
    const abs = join(projectRoot, rel);
    let bytes: Buffer;
    try {
      // Single read + catch — never stat-then-read, which is the TOCTOU file-system
      // race CodeQL flags (js/file-system-race). readFileSync throws ENOENT itself.
      bytes = readFileSync(abs);
    } catch {
      // A named-but-missing artifact hashes its path, so it can't masquerade as real.
      return `${rel}:absent`;
    }
    if (bytes.length === 0) {
      // An empty file is not substantive evidence — mark it so, but don't count it.
      return `${rel}:empty`;
    }
    anyReal = true;
    return `${rel}:${createHash('sha256').update(bytes).digest('hex')}`;
  });
  if (!anyReal) return null;
  return `sha256-${createHash('sha256').update(perFile.join('\n')).digest('hex')}`;
}

function append(
  projectRoot: string,
  sessionId: string,
  ordinal: number,
  ctx: StageEvidenceContext,
  fields: Record<string, unknown>,
): StageEvidenceRow {
  return appendSessionEvent(
    projectRoot,
    STAGE_EVIDENCE_DOC_TYPE,
    sessionId,
    ordinal,
    { conversation_ordinal: ordinal, adapter: ctx.adapter, lane: ctx.lane ?? null, ...fields },
    APPEND_OPTS(ctx.now),
  ) as unknown as StageEvidenceRow;
}
