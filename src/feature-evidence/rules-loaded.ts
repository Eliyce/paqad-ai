// Per-feature rule-loading evidence (issue #557): rules-loaded.json.
//
// The gap this closes: paqad materializes the applicable full rule text into the
// session-context artifact and enforces the process ceremony (plan / spec / review /
// checks), but nothing recorded or required that the rules were actually loaded — so a
// change could go fully green with every project rule unread. This artifact is the
// evidence half: for one change it records which rules apply to which changed files and a
// content hash of the loaded rule text, written by `paqad-ai rules load`. The edit-time
// capability and the completion gate read it; the hash ties the record to the real rule
// bytes (composed by the one canonical composer, INV-1), so it cannot be recorded against
// an empty or absent artifact.
//
// It attests LOADING and acknowledgment, never comprehension (the honest limit of a
// deterministic, no-LLM framework). Written into the ACTIVE feature bundle with the same
// atomic-write + identity content_hash shape as feature.json / plan.json.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { RuleApplicability } from '@/context/rule-context.js';

import { featureFilePath } from './paths.js';
import { currentFeature } from './stage-ledger.js';

/** Doc type stamped on `rules-loaded.json`. */
export const RULES_LOADED_DOC_TYPE = 'paqad.rules-loaded';
export const RULES_LOADED_SCHEMA_VERSION = 1;

/** The rules-loaded record — which rules applied to the change and that their text was loaded. */
export interface RulesLoadedRecord {
  schema_version: number;
  doc_type: typeof RULES_LOADED_DOC_TYPE;
  session_id: string;
  adapter: string;
  /** The changed-file working set the applicable set was computed against. */
  changed_files: string[];
  /** Every rule that applies to the change (always-on + trigger-matched), with matched paths. */
  applicable_rules: RuleApplicability[];
  /** sha256 (hex) of the loaded rule text — ties the record to the real rule bytes. */
  rule_text_hash: string;
  /** The artifact the rule text was loaded from (the session-context rule contract). */
  artifact: string;
  created_at: string;
  /** Identity hash over the record's meaningful fields (excludes created_at + content_hash). */
  content_hash: string;
}

const HASH_EXCLUDED_KEYS = new Set(['content_hash', 'created_at']);

/** Deterministic identity hash over the record's meaningful fields (mirrors mint.ts). */
function computeContentHash(
  record: Omit<RulesLoadedRecord, 'content_hash' | 'created_at'>,
): string {
  const identity = Object.fromEntries(
    Object.entries(record).filter(([key]) => !HASH_EXCLUDED_KEYS.has(key)),
  );
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function atomicWriteJson(absPath: string, value: unknown): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, absPath);
}

/** The inputs a rules-loaded record is built from (the applicability plus context). */
export interface RulesLoadedInput {
  applicable: RuleApplicability[];
  ruleTextHash: string;
  changedPaths: string[];
  adapter?: string;
  now?: () => Date;
}

/** Build a validated-shape rules-loaded record with a stamped content hash. */
export function buildRulesLoadedRecord(
  sessionId: string,
  input: RulesLoadedInput,
): RulesLoadedRecord {
  const base = {
    schema_version: RULES_LOADED_SCHEMA_VERSION,
    doc_type: RULES_LOADED_DOC_TYPE,
    session_id: sessionId,
    adapter: input.adapter ?? 'claude-code',
    changed_files: [...input.changedPaths],
    applicable_rules: input.applicable,
    rule_text_hash: input.ruleTextHash,
    artifact: PATHS.CONTEXT_SESSION_ARTIFACT,
  } satisfies Omit<RulesLoadedRecord, 'created_at' | 'content_hash'>;
  return {
    ...base,
    created_at: (input.now?.() ?? new Date()).toISOString(),
    content_hash: computeContentHash(base),
  };
}

/**
 * Write `rules-loaded.json` into the ACTIVE feature bundle. Returns the record, or null
 * when no feature is active (a rule load outside a feature-development change has no bundle
 * to attach to). Best-effort on the write itself is the caller's concern — a bad path here
 * throws so `rules load` can report it.
 */
export function writeRulesLoaded(
  projectRoot: string,
  sessionId: string,
  input: RulesLoadedInput,
): RulesLoadedRecord | null {
  const dirName = currentFeature(projectRoot, sessionId);
  if (!dirName) {
    return null;
  }
  const record = buildRulesLoadedRecord(sessionId, input);
  atomicWriteJson(join(projectRoot, featureFilePath(dirName, 'rulesLoaded')), record);
  return record;
}

/** Tolerant read of a feature's `rules-loaded.json`, or null when absent/corrupt. */
export function readRulesLoaded(projectRoot: string, dirName: string): RulesLoadedRecord | null {
  try {
    return JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'rulesLoaded')), 'utf8'),
    ) as RulesLoadedRecord;
  } catch {
    return null;
  }
}

/**
 * The rule ids that apply to the change NOW but are absent from a recorded load (issue #557).
 * Empty ⇒ the record covers the change. Used by the completion gate to read a stale load as
 * Inconclusive (new applicable rules appeared since `rules load` ran) without blocking.
 */
export function coverageGaps(
  record: RulesLoadedRecord | null,
  currentApplicableIds: readonly string[],
): string[] {
  const recorded = new Set((record?.applicable_rules ?? []).map((rule) => rule.rule_id));
  return currentApplicableIds.filter((id) => !recorded.has(id));
}
