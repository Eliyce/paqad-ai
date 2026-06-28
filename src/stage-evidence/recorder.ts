// Stage-evidence recorder (issue #247). Script-only — the LLM never hand-authors a
// row; it calls these verbs (open / start / end) through the thin CLI. Unlike the
// RAG recorder (hot path, best-effort/swallow), these are explicit agent calls, so
// an out-of-order start or a validation failure THROWS — the CLI surfaces it as a
// non-zero exit the agent must act on. Timestamps and digests are minted inside the
// script (the script clock + real on-disk bytes), never supplied by the LLM.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  appendSessionEvent,
  currentOrdinal,
  openSessionDoc,
  readSessionUnit,
  type SessionLedgerRow,
} from '@/session-ledger/ledger.js';

import { validateStageEvidenceRow } from './schema.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { isKnownStage, stageIndex } from './stages.js';
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

/** The highest canonical index among stages already started in this change. */
function highestStartedIndex(rows: readonly SessionLedgerRow[]): number {
  let highest = -1;
  for (const row of rows) {
    if (row.kind === 'stage_start' && typeof row.stage === 'string') {
      highest = Math.max(highest, stageIndex(row.stage));
    }
  }
  return highest;
}

/**
 * Record the START of a stage. Rejects an unknown stage, and rejects a stage that
 * is out of order relative to the canonical registry — you cannot start an earlier
 * stage after a later one has already begun (re-starting the SAME stage is a redo
 * and is allowed). The script stamps `started_at` (`ts`).
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
  const rows = readSessionUnit(projectRoot, STAGE_EVIDENCE_DOC_TYPE, sessionId, ordinal);
  const highest = highestStartedIndex(rows);
  const index = stageIndex(stage);
  if (highest >= 0 && index < highest) {
    throw new Error(
      `Out-of-order stage "${stage}": a later stage already started. Stages must run in registry order.`,
    );
  }
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

/** SHA-256 over the real on-disk bytes of each artifact, folded order-independently. */
function hashArtifacts(projectRoot: string, artifactPaths: readonly string[]): string {
  const perFile = [...artifactPaths].sort().map((rel) => {
    const abs = join(projectRoot, rel);
    let bytes: Buffer;
    try {
      statSync(abs);
      bytes = readFileSync(abs);
    } catch {
      // A named-but-missing artifact hashes its path, so it can't masquerade as real.
      return `${rel}:absent`;
    }
    return `${rel}:${createHash('sha256').update(bytes).digest('hex')}`;
  });
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
