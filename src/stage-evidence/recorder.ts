// Stage-evidence recorder (issue #247; re-keyed onto the feature dir, issue #339).
// Script-only — the LLM never hand-authors a row; it calls these verbs (open / start
// / end) through the thin CLI. Unlike the RAG recorder (hot path, best-effort/swallow),
// these are explicit agent calls, so a validation failure THROWS — the CLI surfaces it
// as a non-zero exit the agent must act on. Timestamps and digests are minted inside
// the script (the script clock + real on-disk bytes), never supplied by the LLM.
//
// Storage moved (issue #339): a change's rows live in its per-feature bundle at
// `.paqad/ledger/feature-evidence/<dirName>/stage-evidence.jsonl`, resolved from the
// active feature in the `_session` control — no longer `<session>/<ordinal>.jsonl`. The
// change key is the feature dir name. The row schema + hashing are unchanged.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  appendFeatureStageRow,
  currentFeature,
  openFeatureChange,
} from '@/feature-evidence/stage-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import { resolveSessionId } from '@/rag-ledger/session.js';
import { readPendingLane } from './pending-lane.js';
import { isKnownStage } from './stages.js';
import { type StageEvidenceRow } from './types.js';

export interface StageEvidenceContext {
  /** Host session id (Claude hook stdin); resolved/minted when absent. */
  sessionId?: string | null;
  /** Feature dir to attach to; resolved from the active `_session` control when absent. */
  dirName?: string;
  /** Provider adapter (claude-code, codex-cli, …). */
  adapter: string;
  lane?: 'fast' | 'graduated' | 'full' | null;
  /** Open a NEW named feature (the "new work" signal) instead of resolving the active. */
  title?: string;
  /** Ticket ref for a titled feature (verbatim, or null to force none). */
  issue?: string | null;
  /** Clock seam for tests. */
  now?: () => Date;
}

/**
 * Open a code-change record for the session and return its feature dir name (the change
 * key). Called as the FIRST action of any code change. A `title` mints a NEW named
 * feature and switches to it; otherwise the active feature is reused, or an untitled
 * `change-<ULID>` is minted when none is active. The lane stamped on the open row is the
 * explicit `ctx.lane` (even null) when given, else the lane the prompt seam stashed for
 * this session (issue #324), so the first edit/marker carries the classifier's lane.
 */
export function openStageEvidence(
  projectRoot: string,
  ctx: StageEvidenceContext,
): { sessionId: string; dirName: string; changeKey: string } {
  const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
  const lane = ctx.lane !== undefined ? ctx.lane : readPendingLane(projectRoot, sessionId);
  const dirName = openFeatureChange(projectRoot, sessionId, {
    adapter: ctx.adapter,
    lane: lane ?? null,
    title: ctx.title,
    issue: ctx.issue,
    now: ctx.now,
  });
  return { sessionId, dirName, changeKey: dirName };
}

/** Resolve the feature dir to write to: explicit, else the active one, else auto-open. */
function resolveDirName(projectRoot: string, sessionId: string, ctx: StageEvidenceContext): string {
  if (ctx.dirName) {
    return ctx.dirName;
  }
  const active = currentFeature(projectRoot, sessionId);
  if (active) {
    return active;
  }
  // No active feature — auto-open one so a stage call never lands on nothing.
  return openStageEvidence(projectRoot, ctx).dirName;
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
  const dirName = resolveDirName(projectRoot, sessionId, ctx);
  return append(projectRoot, sessionId, dirName, ctx, {
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
  const dirName = resolveDirName(projectRoot, sessionId, ctx);
  const artifactPaths = input.artifactPaths ?? [];
  const artifactDigest =
    artifactPaths.length > 0 ? hashArtifacts(projectRoot, artifactPaths) : null;
  const subjectDigest =
    stage === 'development'
      ? (input.subjectDigest ?? artifactDigest)
      : (input.subjectDigest ?? null);
  return append(projectRoot, sessionId, dirName, ctx, {
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
  dirName: string,
  ctx: StageEvidenceContext,
  fields: Record<string, unknown>,
): StageEvidenceRow {
  return appendFeatureStageRow(
    projectRoot,
    sessionId,
    dirName,
    { adapter: ctx.adapter, lane: ctx.lane ?? null, ...fields },
    ctx.now,
  ) as unknown as StageEvidenceRow;
}

export type { SessionLedgerRow };
