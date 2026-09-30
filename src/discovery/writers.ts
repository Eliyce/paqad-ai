// Discovery canonical artifact writers (issue #597).
//
// Each writer stamps a body through the shared feature-evidence envelope (six-field header + a
// content hash over the identity, so a hand edit is detectable) and writes it under the run dir:
// JSON documents atomically (temp + rename), JSONL rows appended one line at a time. The change key
// is the run ULID, so every artifact names the same run. Substantive body content is model-supplied
// through the CLI input contract; the writer owns every mechanical field (DW-07).

import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { buildDocumentEnvelope, stampBundleRow } from '@/feature-evidence/envelope.js';

import { discoveryRunChangeKey, discoveryRunFilePath, type DiscoveryRunFile } from './paths.js';
import type {
  DiscoveryBriefBody,
  DiscoveryBriefRecord,
  DiscoveryBlockerRow,
  DiscoveryContextReceiptRow,
  DiscoveryContributionRow,
  DiscoveryDecisionsBody,
  DiscoveryDecisionsRecord,
  DiscoveryHandoffBody,
  DiscoveryHandoffRecord,
  DiscoveryReadinessBody,
  DiscoveryReadinessRecord,
  DiscoverySourceRow,
  DiscoverySynthesisBody,
  DiscoverySynthesisRecord,
} from './records.js';
import { DISCOVERY_DOC_TYPES, DISCOVERY_SCHEMA_VERSION } from './types.js';

/** The identity every writer needs: the run and the session writing the artifact. */
export interface DiscoveryWriteContext {
  projectRoot: string;
  dirName: string;
  sessionId: string;
  now?: () => Date;
}

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
}

function writeDoc<B extends Record<string, unknown>>(
  ctx: DiscoveryWriteContext,
  file: DiscoveryRunFile,
  docType: string,
  body: B,
): B & { doc_type: string } {
  const record = buildDocumentEnvelope({
    docType,
    change: discoveryRunChangeKey(ctx.dirName),
    sessionId: ctx.sessionId,
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    now: ctx.now,
    body,
  });
  atomicWriteJson(join(ctx.projectRoot, discoveryRunFilePath(ctx.dirName, file)), record);
  return record as B & { doc_type: string };
}

function appendRow(
  ctx: DiscoveryWriteContext,
  file: DiscoveryRunFile,
  docType: string,
  row: Record<string, unknown>,
): void {
  const stamped = stampBundleRow({
    docType,
    change: discoveryRunChangeKey(ctx.dirName),
    sessionId: ctx.sessionId,
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    now: ctx.now,
    row,
  });
  const abs = join(ctx.projectRoot, discoveryRunFilePath(ctx.dirName, file));
  mkdirSync(dirname(abs), { recursive: true });
  appendFileSync(abs, `${JSON.stringify(stamped)}\n`, 'utf8');
}

/** Write the Understand-stage brief (`brief.json`). */
export function writeBrief(
  ctx: DiscoveryWriteContext,
  body: DiscoveryBriefBody,
): DiscoveryBriefRecord {
  return writeDoc(ctx, 'brief', DISCOVERY_DOC_TYPES.brief, { ...body }) as DiscoveryBriefRecord;
}

/** Write the chief synthesis (`synthesis.json`). */
export function writeSynthesis(
  ctx: DiscoveryWriteContext,
  body: DiscoverySynthesisBody,
): DiscoverySynthesisRecord {
  return writeDoc(ctx, 'synthesis', DISCOVERY_DOC_TYPES.synthesis, {
    ...body,
  }) as DiscoverySynthesisRecord;
}

/** Write the Decide-stage decision index (`decisions.json`). */
export function writeDecisions(
  ctx: DiscoveryWriteContext,
  body: DiscoveryDecisionsBody,
): DiscoveryDecisionsRecord {
  return writeDoc(ctx, 'decisions', DISCOVERY_DOC_TYPES.decisions, {
    ...body,
  }) as DiscoveryDecisionsRecord;
}

/** Write the readiness verdict (`readiness.json`). */
export function writeReadiness(
  ctx: DiscoveryWriteContext,
  body: DiscoveryReadinessBody,
): DiscoveryReadinessRecord {
  return writeDoc(ctx, 'readiness', DISCOVERY_DOC_TYPES.readiness, {
    ...body,
  }) as DiscoveryReadinessRecord;
}

/** Write the hand-off record (`handoff.json`). */
export function writeHandoff(
  ctx: DiscoveryWriteContext,
  body: DiscoveryHandoffBody,
): DiscoveryHandoffRecord {
  return writeDoc(ctx, 'handoff', DISCOVERY_DOC_TYPES.handoff, {
    ...body,
  }) as DiscoveryHandoffRecord;
}

/** Append one attributable research source (`sources.jsonl`). */
export function appendSource(ctx: DiscoveryWriteContext, row: DiscoverySourceRow): void {
  appendRow(ctx, 'sources', DISCOVERY_DOC_TYPES.source, { ...row });
}

/** Append one reusable-expert contribution (`contributions.jsonl`). */
export function appendContribution(
  ctx: DiscoveryWriteContext,
  row: DiscoveryContributionRow,
): void {
  appendRow(ctx, 'contributions', DISCOVERY_DOC_TYPES.contribution, { ...row });
}

/** Append one stage-local context load receipt (`context-receipts.jsonl`). */
export function appendContextReceipt(
  ctx: DiscoveryWriteContext,
  row: DiscoveryContextReceiptRow,
): void {
  appendRow(ctx, 'contextReceipts', DISCOVERY_DOC_TYPES.contextReceipt, { ...row });
}

/** Append one recorded blocker (`blockers.jsonl`). */
export function appendBlocker(ctx: DiscoveryWriteContext, row: DiscoveryBlockerRow): void {
  appendRow(ctx, 'blockers', DISCOVERY_DOC_TYPES.blocker, { ...row });
}
