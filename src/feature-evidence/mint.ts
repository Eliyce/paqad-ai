import { createHash } from 'node:crypto';

import { ulid as mintUlid } from '@/core/ids/ulid.js';
import type { TicketProviderKind } from '@/core/types/project-profile.js';
import { deriveSlug } from '@/planning/slug-utils.js';
import { detectTicketRefs } from '@/planning/ticket-ref-detect.js';

import { buildDocumentEnvelope } from './envelope.js';
import { formatFeatureDirName } from './paths.js';
import type { PlanReuse } from './reuse.js';
import {
  FEATURE_DOC_SCHEMA_VERSION,
  FEATURE_DOC_TYPE,
  PLAN_DOC_TYPE,
  REVIEW_DOC_TYPE,
  type FeatureLane,
  type FeatureRecord,
  type FeatureStatus,
  type PlanRecord,
  type PlanRisk,
  type PlanStep,
  type ReviewFinding,
  type ReviewRecord,
  type ReviewVerdict,
} from './types.js';

export const UNTITLED_FEATURE_TITLE = 'change';

const HASH_EXCLUDED_KEYS = new Set(['content_hash', 'created_at', 'updated_at', 'recorded_at']);

export function computeContentHash(record: Record<string, unknown>): string {
  const identity: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (!HASH_EXCLUDED_KEYS.has(key)) {
      identity[key] = record[key];
    }
  }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export interface MintFeatureDirNameInput {
  title: string;
  issue?: string | null;
  trackerKind?: TicketProviderKind;
  ulid?: string;
  ulidSeed?: number;
}

export interface MintedFeatureDirName {
  dirName: string;
  issue: string | null;
  slug: string;
  ulid: string;
}

export function mintFeatureDirName(input: MintFeatureDirNameInput): MintedFeatureDirName {
  const issue = resolveIssue(input);
  const slug = deriveSlug(titleWithoutRef(input.title, issue));
  const ulid = input.ulid ?? mintUlid(input.ulidSeed);
  const dirName = formatFeatureDirName({ issue, slug, ulid });
  return { dirName, issue, slug, ulid };
}

function resolveIssue(input: MintFeatureDirNameInput): string | null {
  if (input.issue !== undefined) {
    return normalizeIssue(input.issue);
  }
  const refs = detectTicketRefs(input.title, input.trackerKind ?? 'generic');
  return normalizeIssue(refs[0] ?? null);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleWithoutRef(title: string, issue: string | null): string {
  if (issue === null) {
    return title;
  }
  const ref = escapeRegExp(issue);
  const tail = '(?![A-Za-z0-9])[:\\-\\s]*';
  const pattern = /^\d+$/.test(issue)
    ? new RegExp(`(?:(?<![\\w/])#${ref}|^\\s*${ref})${tail}`, 'gi')
    : new RegExp(`(?<![A-Za-z0-9])#?${ref}${tail}`, 'gi');
  const stripped = title.replace(pattern, ' ').trim();
  return /[a-z0-9]/i.test(stripped) ? stripped : title;
}

function normalizeIssue(issue: string | null): string | null {
  if (issue === null) {
    return null;
  }
  const stripped = issue.replace(/^#/, '').trim();
  return stripped.length > 0 ? stripped : null;
}

interface DocumentIdentityInput {
  change: string;
  session_id: string;
  now?: () => Date;
}

export interface BuildFeatureRecordInput extends DocumentIdentityInput {
  issue: string | null;
  title: string;
  slug: string;
  lane?: FeatureLane;
  status?: FeatureStatus;
  spec_id?: string | null;
  adapter: string;
  branch?: string | null;
  base_branch?: string | null;
  recorded_at?: string;
}

export function buildFeatureRecord(input: BuildFeatureRecordInput): FeatureRecord {
  const now = input.now ?? (() => new Date());
  const updatedAt = now().toISOString();
  const openedAt = input.recorded_at;
  return buildDocumentEnvelope({
    docType: FEATURE_DOC_TYPE,
    change: input.change,
    sessionId: input.session_id,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    now: openedAt === undefined ? () => new Date(updatedAt) : () => new Date(openedAt),
    body: {
      issue: input.issue,
      title: input.title,
      slug: input.slug,
      lane: input.lane ?? null,
      status: input.status ?? 'active',
      spec_id: input.spec_id ?? null,
      adapter: input.adapter,
      branch: input.branch ?? null,
      base_branch: input.base_branch ?? null,
      updated_at: updatedAt,
    },
  }) as FeatureRecord;
}

export interface BuildPlanRecordInput extends DocumentIdentityInput {
  summary: string;
  steps?: PlanStep[];
  modules_touched?: string[];
  decisions?: string[];
  risks?: PlanRisk[];
  reuse?: PlanReuse;
}

export interface BuildReviewRecordInput extends DocumentIdentityInput {
  summary: string;
  verdict: ReviewVerdict;
  findings?: ReviewFinding[];
  checked?: string[];
  rollback: string;
}

export function buildReviewRecord(input: BuildReviewRecordInput): ReviewRecord {
  return buildDocumentEnvelope({
    docType: REVIEW_DOC_TYPE,
    change: input.change,
    sessionId: input.session_id,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    now: input.now,
    body: {
      summary: input.summary,
      verdict: input.verdict,
      findings: input.findings ?? [],
      checked: input.checked ?? [],
      rollback: input.rollback,
    },
  }) as ReviewRecord;
}

export function buildPlanRecord(input: BuildPlanRecordInput): PlanRecord {
  return buildDocumentEnvelope({
    docType: PLAN_DOC_TYPE,
    change: input.change,
    sessionId: input.session_id,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    now: input.now,
    body: {
      summary: input.summary,
      steps: input.steps ?? [],
      modules_touched: input.modules_touched ?? [],
      decisions: input.decisions ?? [],
      risks: input.risks ?? [],
      ...(input.reuse === undefined ? {} : { reuse: input.reuse }),
    },
  }) as PlanRecord;
}
