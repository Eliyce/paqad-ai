import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sessionReattachableFeature } from '@/feature-evidence/adoption.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';
import {
  appendFeatureStageRow,
  currentFeature,
  openFeatureChange,
  recordChangeConstants,
  resumeFeatureByRef,
} from '@/feature-evidence/stage-ledger.js';
import { readGitState } from '@/rag/git-state.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import { resolveSessionId } from '@/rag-ledger/session.js';
import { agentForWriter } from './agent-identity.js';
import { readPendingKind, readPendingLane } from './pending-lane.js';
import { isKnownStage } from './stages.js';
import { type StageEvidenceRow, type StageSessionSource } from './types.js';

export interface StageEvidenceContext {
  sessionId?: string | null;
  dirName?: string;
  adapter: string;
  agent?: string;
  agentId?: string;
  lane?: 'fast' | 'graduated' | 'full' | null;
  sessionSource?: StageSessionSource;
  title?: string;
  issue?: string | null;
  now?: () => Date;
}

export function openStageEvidence(
  projectRoot: string,
  ctx: StageEvidenceContext,
): { sessionId: string; dirName: string; changeKey: string } {
  const sessionId = resolveSessionId(projectRoot, ctx.sessionId);
  const lane = ctx.lane !== undefined ? ctx.lane : sessionLane(projectRoot, sessionId);
  const kind = readPendingKind(projectRoot, sessionId);
  const dirName = openFeatureChange(projectRoot, sessionId, {
    adapter: ctx.adapter,
    lane: lane ?? null,
    ...(kind !== null ? { kind } : {}),
    title: ctx.title,
    issue: ctx.issue,
    now: ctx.now,
  });
  return { sessionId, dirName, changeKey: dirName };
}

function sessionLane(projectRoot: string, sessionId: string): StageEvidenceContext['lane'] {
  return readPendingLane(projectRoot, sessionId) ?? readSessionControl(projectRoot, sessionId).lane;
}

function reattachSessionFeature(
  projectRoot: string,
  sessionId: string,
  ctx: StageEvidenceContext,
): string | null {
  const branch = readGitState(projectRoot).branch ?? null;
  const own = sessionReattachableFeature(projectRoot, sessionId, branch);
  return own ? resumeFeatureByRef(projectRoot, sessionId, own, ctx.now) : null;
}

function resolveDirName(projectRoot: string, sessionId: string, ctx: StageEvidenceContext): string {
  if (ctx.dirName) {
    return ctx.dirName;
  }
  const active = currentFeature(projectRoot, sessionId);
  if (active) {
    return active;
  }
  return (
    reattachSessionFeature(projectRoot, sessionId, ctx) ??
    openStageEvidence(projectRoot, ctx).dirName
  );
}

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
    ...(ctx.agentId ? { agent_id: ctx.agentId } : {}),
  });
}

export interface EndStageInput {
  artifactPaths?: string[];
  subjectDigest?: string | null;
  note?: string | null;
}

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

function hashArtifacts(projectRoot: string, artifactPaths: readonly string[]): string | null {
  let anyReal = false;
  const perFile = [...artifactPaths].sort().map((rel) => {
    const abs = join(projectRoot, rel);
    let bytes: Buffer;
    try {
      bytes = readFileSync(abs);
    } catch {
      return `${rel}:absent`;
    }
    if (bytes.length === 0) {
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
  recordChangeConstants(projectRoot, dirName, { adapter: ctx.adapter, lane: ctx.lane }, ctx.now);
  return appendFeatureStageRow(
    projectRoot,
    sessionId,
    dirName,
    {
      agent: ctx.agent ?? agentForWriter(ctx.adapter),
      ...(ctx.sessionSource === undefined ? {} : { session_source: ctx.sessionSource }),
      ...fields,
    },
    ctx.now,
  ) as unknown as StageEvidenceRow;
}

export type { SessionLedgerRow };
