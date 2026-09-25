// Feature dir-name mint + rigid record builders (issue #339, Phase 1 — dark).
//
// The dir name is the immutable change key: `<issue>-<slug>-<ULID>`. It is minted
// once, at feature birth, from the title + optional ticket ref, reusing the
// existing slug, ticket-detect, and ULID primitives. The record builders stamp a
// deterministic `content_hash` (SHA-256 over identity fields, volatile timestamps
// excluded) so a hand-edit to a stored file is detectable — the model never owns
// these bytes.

import { createHash } from 'node:crypto';

import { ulid as mintUlid } from '@/core/ids/ulid.js';
import type { TicketProviderKind } from '@/core/types/project-profile.js';
import { deriveSlug } from '@/planning/slug-utils.js';
import { detectTicketRefs } from '@/planning/ticket-ref-detect.js';

import { formatFeatureDirName } from './paths.js';
import type { PlanReuse } from './reuse.js';
import {
  FEATURE_DOC_TYPE,
  FEATURE_EVIDENCE_SCHEMA_VERSION,
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

/**
 * The literal title an untitled feature is minted with (a bare stage marker carries
 * no title), producing the generic `change-<ULID>` dir name the plan-compile
 * back-fill later renames (issue #403).
 */
export const UNTITLED_FEATURE_TITLE = 'change';

/**
 * Keys excluded from a record's identity hash (volatile / non-identifying). `recorded_at` is
 * the #581 envelope time field that replaces `created_at`, so it is excluded the same way; a
 * record written before #581 never carries it, so its hash is unchanged.
 */
const HASH_EXCLUDED_KEYS = new Set(['content_hash', 'created_at', 'updated_at', 'recorded_at']);

/** SHA-256 over a record's identity fields in a stable key order. */
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
  /** Human title of the feature; the slug is derived from it. */
  title: string;
  /**
   * Explicit ticket/issue ref (`339`, `PQD-123`). `undefined` ⇒ detect from the
   * title; `null` ⇒ force no issue. A detected ref is used verbatim.
   */
  issue?: string | null;
  /** Tracker kind for detection; defaults to `generic` (matches both shapes). */
  trackerKind?: TicketProviderKind;
  /** Deterministic ULID seam for tests (a fixed ULID or a seed time). */
  ulid?: string;
  ulidSeed?: number;
}

export interface MintedFeatureDirName {
  dirName: string;
  issue: string | null;
  slug: string;
  ulid: string;
}

/**
 * Mint a feature dir name from a title + optional issue. When `issue` is omitted,
 * the first ticket ref in the title is detected and used; when it is `null`, no
 * issue prefix is emitted. The slug comes from {@link deriveSlug}; the ULID is
 * script-minted (or the test seam).
 */
export function mintFeatureDirName(input: MintFeatureDirNameInput): MintedFeatureDirName {
  const issue = resolveIssue(input);
  // Issue #581 (FR-13) — the ref already leads the dir name, so it is taken out of the title
  // before slugging: "PROJ-123 Checkout page" mints `PROJ-123-checkout-page-<ULID>`, not
  // `PROJ-123-proj-123-checkout-page-<ULID>`. A title with no ref slugs exactly as before.
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

/**
 * The title with the dir name's ticket ref removed (issue #581, FR-13): matched
 * case-insensitively, with a leading `#` and any trailing `:`, `-` or space. A key ref
 * (`PROJ-123`) is removed wherever it stands as a whole token. A bare-number ref (`45`) is
 * removed only as `#45` or when it leads the title, so a number that is just part of the
 * wording ("Show 45 rows") is kept. When nothing but the ref was in the title, the title is
 * kept whole so the slug still has something to say.
 */
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

/**
 * Normalise a ticket ref into a dir-name-safe token. `detectTicketRefs` returns a
 * github ref verbatim as `#45`, but the dir name (and `feature.json.issue`) carry
 * the bare number `45` so the name stays parseable — the leading `#` is stripped.
 * A ref that empties out (e.g. a lone `#`) becomes `null`.
 */
function normalizeIssue(issue: string | null): string | null {
  if (issue === null) {
    return null;
  }
  const stripped = issue.replace(/^#/, '').trim();
  return stripped.length > 0 ? stripped : null;
}

export interface BuildFeatureRecordInput {
  issue: string | null;
  title: string;
  slug: string;
  ulid: string;
  lane?: FeatureLane;
  status?: FeatureStatus;
  spec_id?: string | null;
  session_first_seen: string;
  adapter: string;
  branch?: string | null;
  base_branch?: string | null;
  now?: () => Date;
}

/** Build a validated-shape `feature.json` record with a stamped `content_hash`. */
export function buildFeatureRecord(input: BuildFeatureRecordInput): FeatureRecord {
  const stamp = (input.now ?? (() => new Date()))().toISOString();
  const base = {
    schema_version: FEATURE_EVIDENCE_SCHEMA_VERSION,
    doc_type: FEATURE_DOC_TYPE,
    issue: input.issue,
    title: input.title,
    slug: input.slug,
    ulid: input.ulid,
    lane: input.lane ?? null,
    status: input.status ?? 'active',
    spec_id: input.spec_id ?? null,
    session_first_seen: input.session_first_seen,
    adapter: input.adapter,
    branch: input.branch ?? null,
    base_branch: input.base_branch ?? null,
  } satisfies Omit<FeatureRecord, 'created_at' | 'updated_at' | 'content_hash'>;
  return {
    ...base,
    created_at: stamp,
    updated_at: stamp,
    content_hash: computeContentHash(base),
  };
}

export interface BuildPlanRecordInput {
  issue: string | null;
  title: string;
  slug: string;
  ulid: string;
  summary: string;
  steps?: PlanStep[];
  modules_touched?: string[];
  decisions?: string[];
  risks?: PlanRisk[];
  /** The reuse declaration (issue #357); absent only for a record built pre-gate. */
  reuse?: PlanReuse;
  now?: () => Date;
}

export interface BuildReviewRecordInput {
  issue: string | null;
  title: string;
  slug: string;
  ulid: string;
  summary: string;
  verdict: ReviewVerdict;
  findings?: ReviewFinding[];
  checked?: string[];
  rollback: string;
  now?: () => Date;
}

/** Build a validated-shape `review.json` record with a stamped `content_hash` (issue #402). */
export function buildReviewRecord(input: BuildReviewRecordInput): ReviewRecord {
  const stamp = (input.now ?? (() => new Date()))().toISOString();
  const base = {
    schema_version: FEATURE_EVIDENCE_SCHEMA_VERSION,
    doc_type: REVIEW_DOC_TYPE,
    issue: input.issue,
    title: input.title,
    slug: input.slug,
    ulid: input.ulid,
    summary: input.summary,
    verdict: input.verdict,
    findings: input.findings ?? [],
    checked: input.checked ?? [],
    rollback: input.rollback,
  } satisfies Omit<ReviewRecord, 'created_at' | 'updated_at' | 'content_hash'>;
  return {
    ...base,
    created_at: stamp,
    updated_at: stamp,
    content_hash: computeContentHash(base),
  };
}

/** Build a validated-shape `plan.json` record with a stamped `content_hash`. */
export function buildPlanRecord(input: BuildPlanRecordInput): PlanRecord {
  const stamp = (input.now ?? (() => new Date()))().toISOString();
  const base = {
    schema_version: FEATURE_EVIDENCE_SCHEMA_VERSION,
    doc_type: PLAN_DOC_TYPE,
    issue: input.issue,
    title: input.title,
    slug: input.slug,
    ulid: input.ulid,
    summary: input.summary,
    steps: input.steps ?? [],
    modules_touched: input.modules_touched ?? [],
    decisions: input.decisions ?? [],
    risks: input.risks ?? [],
    // Omitted entirely when absent: the stored schema leaves `reuse` optional so a
    // pre-#357 plan.json stays valid, and a literal `undefined` would serialise into the
    // identity hash differently than the missing key it represents.
    ...(input.reuse === undefined ? {} : { reuse: input.reuse }),
  } satisfies Omit<PlanRecord, 'created_at' | 'updated_at' | 'content_hash'>;
  return {
    ...base,
    created_at: stamp,
    updated_at: stamp,
    content_hash: computeContentHash(base),
  };
}
