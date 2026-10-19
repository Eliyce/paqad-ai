// Issue #639, Part 11 — the change-scoped acceptance-criteria-to-test map.
//
// The whole-tree gatherer (`inputs.ts`) never reads the frozen spec, so in production no
// map carried the change's acceptance criteria and the `ac-test-mapping` gate passed on
// nothing. This gatherer reads the frozen spec's AUTOMATED criteria and the test files
// changed on the branch, and feeds the existing pure builder. A criterion is proved by a
// changed test file that names its id in a test title, a describe title, or an
// `@obligation <ID>` tag, matched on a word boundary (so AC-1 never matches AC-10 or AC-1x).
// Visual criteria stay with the visual-evidence gate and manual criteria need no test, so
// neither becomes a promise here (owner decision D-01M5AM0EHCSXHFZDFCYW4WB925).
//
// It never scans the whole source tree: no delivery, no markers, no import edges. The map's
// `anchors_known` therefore stays false, which keeps the readers that need a whole-tree map
// (scope drift, the dead-code ratchet measure) exactly where they were before this map
// existed.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { toPosixPath } from '@/core/path-utils.js';
import type { VerificationCriterion } from '@/core/types/planning.js';
import type { Lane } from '@/core/types/routing.js';
import type { StructuredTestResult } from '@/core/types/test-output.js';
import type { ProofEntry, PromiseRef, TraceabilityMap } from '@/core/types/traceability.js';
import { readFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { isTestFile } from '@/pipeline/change-evidence.js';
import { extractAcIdFromIssue } from '@/verification/gates/ac-test-mapping.js';

import { readObligationPromises } from './inputs.js';
import { buildTraceabilityMap } from './map-builder.js';
import { writeTraceabilityMap } from './writer.js';

/** Source files a test title or tag can live in. Anything else (fixtures, snapshots) is skipped. */
const SCANNABLE_TEST_FILE = /\.(?:[cm]?[jt]sx?|py|rb|php|go|java|kt|kts|cs|rs|swift|ex|exs)$/;
/** A test file larger than this is not read (a generated fixture, not a test someone wrote). */
const MAX_TEST_FILE_BYTES = 2 * 1024 * 1024;
/** A test call: `it(`, `test(`, `describe(`, with any `.skip` / `.only` / `.each` modifiers. */
const TEST_CALL = /(?<![\w$.])(?:it|test|describe|suite|context)((?:\.[A-Za-z]+)*)\s*\(/g;
/** An `@obligation` tag; the rest of its line is matched like a title. */
const OBLIGATION_TAG = /@obligation\b([^\n]*)/g;

export interface BuildChangeTraceabilityMapOptions {
  projectRoot: string;
  /** The active change's feature bundle directory; null when no change is open. */
  dirName: string | null;
  /** Project-relative files changed on the branch (`loadChangeEvidence`). */
  changedFiles: readonly string[];
  /** Criterion ids a failing test named; such a criterion is not proved. */
  failingAcIds?: readonly string[];
  /** Recorded test results; a failing or erroring test that names a criterion unproves it. */
  testResults?: readonly StructuredTestResult[];
  lane: Lane;
  now?: () => string;
}

export interface ChangeTraceabilityResult {
  map: TraceabilityMap;
  /** Automated criterion ids: the promises the map carries. */
  automated: string[];
  /** Visual criterion ids, left to the visual-evidence gate. */
  visual: string[];
  /** Manual criterion ids, which need no mapped test. */
  manual: string[];
}

/**
 * Build the change-scoped map, or null when the change has no frozen spec (nothing to map).
 * Throws only on a real fault; callers treat a throw as "the map could not be built".
 */
export function buildChangeTraceabilityMap(
  options: BuildChangeTraceabilityMapOptions,
): ChangeTraceabilityResult | null {
  if (!options.dirName) return null;
  const spec = readFeatureSpecification(options.projectRoot, options.dirName);
  if (!spec || !spec.frozen) return null;

  const criteria: VerificationCriterion[] = Array.isArray(spec.acceptance_criteria)
    ? spec.acceptance_criteria
    : [];
  const automated = criteria.filter((c) => c.proof_type === 'automated');
  const automatedIds = automated.map((c) => c.criterion_id);
  const failing = collectFailingAcIds(automatedIds, options.failingAcIds, options.testResults);

  const proofsByAc = new Map<string, Set<string>>();
  for (const file of changedTestFiles(options.changedFiles)) {
    const texts = readTitlesAndTags(options.projectRoot, file);
    if (texts.length === 0) continue;
    for (const id of automatedIds) {
      if (failing.has(id)) continue;
      if (!texts.some((text) => namesCriterion(text, id))) continue;
      const bucket = proofsByAc.get(id) ?? new Set<string>();
      bucket.add(file);
      proofsByAc.set(id, bucket);
    }
  }

  const acIdSet = new Set(automatedIds);
  const promises: PromiseRef[] = automated.map((c) => ({
    promise_id: c.criterion_id,
    description: describeCriterion(c),
    source: 'acceptance-criterion',
  }));
  const proofs: ProofEntry[] = [...proofsByAc].map(([promise_id, files]) => ({
    promise_id,
    checks: [...files].sort(),
  }));

  // Keep the compliance obligations the whole-tree map carried. An obligation that shares
  // an id with a frozen criterion is dropped with its proofs, so a whole-tree compliance
  // scan can never prove a criterion this change did not.
  const obligations = readObligationPromises(options.projectRoot);
  promises.push(...obligations.promises.filter((p) => !acIdSet.has(p.promise_id)));
  proofs.push(...obligations.proofs.filter((p) => !acIdSet.has(p.promise_id)));

  const map = buildTraceabilityMap({
    lane: options.lane,
    now: options.now ?? (() => new Date().toISOString()),
    promises,
    delivery: [],
    proofs,
    edges: [],
    codeUniverse: [],
    changedFiles: [...options.changedFiles],
    markers: [],
  });

  return {
    map: { ...map, scope: 'change', change: options.dirName },
    automated: automatedIds,
    visual: criteria.filter((c) => c.proof_type === 'visual').map((c) => c.criterion_id),
    manual: criteria.filter((c) => c.proof_type === 'manual').map((c) => c.criterion_id),
  };
}

export interface ChangeTraceabilityBuild {
  /** The built map, or null when there is no frozen spec or the build failed. */
  result: ChangeTraceabilityResult | null;
  /** Why the build failed, or null when it did not fail. */
  error: string | null;
}

/**
 * Build the change map and write it through the traceability writer. Best-effort: a fault is
 * reported through `onError` and returned as `error`, never thrown, so a map that cannot be
 * built never breaks `checks run` or the Stop verification.
 */
export async function buildAndWriteChangeTraceabilityMap(
  options: BuildChangeTraceabilityMapOptions,
  onError: (message: string) => void,
): Promise<ChangeTraceabilityBuild> {
  let result: ChangeTraceabilityResult | null;
  try {
    result = buildChangeTraceabilityMap(options);
  } catch (error) {
    const message = `could not build the acceptance-criteria map (${describeError(error)})`;
    onError(message);
    return { result: null, error: message };
  }
  if (result) {
    try {
      await writeTraceabilityMap(options.projectRoot, result.map);
    } catch (error) {
      // The map was built, so the gate can still read it; only the file is missing.
      onError(`could not write the acceptance-criteria map (${describeError(error)})`);
    }
  }
  return { result, error: null };
}

/** True when `text` names `id` on a word boundary: AC-1 matches "AC-1:" but not AC-10 or AC-1x. */
export function namesCriterion(text: string, id: string): boolean {
  if (!id) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_.-])${escaped}(?![A-Za-z0-9_]|[-.][A-Za-z0-9])`).test(text);
}

/**
 * The titles of every test and describe call in `source`, plus the rest of the line after
 * each `@obligation` tag. Handles `it.each([...])('title', ...)` by skipping the table.
 */
export function extractTitlesAndTags(source: string): string[] {
  const texts: string[] = [];
  TEST_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEST_CALL.exec(source)) !== null) {
    let index = match.index + match[0].length;
    if (/\.(?:each|for)\b/.test(match[1]!)) {
      const close = skipBalanced(source, index);
      if (close === -1) continue;
      index = skipSpace(source, close + 1);
      if (source[index] !== '(') continue;
      index += 1;
    }
    const title = readStringLiteral(source, skipSpace(source, index));
    if (title !== null) texts.push(title);
  }
  OBLIGATION_TAG.lastIndex = 0;
  while ((match = OBLIGATION_TAG.exec(source)) !== null) {
    const rest = match[1]!.split('*/')[0]!.trim();
    if (rest.length > 0) texts.push(rest);
  }
  return texts;
}

function changedTestFiles(changedFiles: readonly string[]): string[] {
  const files = new Set<string>();
  for (const raw of changedFiles) {
    const file = toPosixPath(raw);
    if (isTestFile(file) && SCANNABLE_TEST_FILE.test(file)) files.add(file);
  }
  return [...files].sort();
}

function readTitlesAndTags(projectRoot: string, file: string): string[] {
  const abs = join(projectRoot, file);
  try {
    // A deleted file is still in the changed list; it proves nothing.
    if (statSync(abs).size > MAX_TEST_FILE_BYTES) return [];
    return extractTitlesAndTags(readFileSync(abs, 'utf8'));
  } catch {
    return [];
  }
}

function collectFailingAcIds(
  automatedIds: readonly string[],
  explicit: readonly string[] | undefined,
  results: readonly StructuredTestResult[] | undefined,
): Set<string> {
  const failing = new Set<string>(explicit ?? []);
  for (const result of results ?? []) {
    for (const issue of [...(result.failures ?? []), ...(result.errors ?? [])]) {
      const extracted = extractAcIdFromIssue(issue);
      if (extracted) failing.add(extracted);
      const texts = [issue.test_id, issue.suite ?? ''].filter((text) => text.length > 0);
      for (const id of automatedIds) {
        if (texts.some((text) => namesCriterion(text, id))) failing.add(id);
      }
    }
  }
  return failing;
}

function describeCriterion(criterion: VerificationCriterion): string {
  const parts = [
    criterion.given ? `Given ${criterion.given}` : '',
    criterion.when ? `when ${criterion.when}` : '',
    criterion.then ? `then ${criterion.then}` : '',
  ].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(', ') : criterion.criterion_id;
}

function skipSpace(source: string, index: number): number {
  let i = index;
  while (i < source.length && /\s/.test(source[i]!)) i += 1;
  return i;
}

/** Index of the `)` closing the group opened just before `index`, or -1. Skips strings. */
function skipBalanced(source: string, index: number): number {
  let depth = 1;
  const limit = Math.min(source.length, index + 200_000);
  for (let i = index; i < limit; i += 1) {
    const ch = source[i]!;
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = stringEnd(source, i);
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return ch === ')' ? i : -1;
    }
  }
  return -1;
}

/** Index of the quote closing the string literal opening at `index`, or -1. */
function stringEnd(source: string, index: number): number {
  const quote = source[index]!;
  for (let i = index + 1; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === quote) return i;
    if (ch === '\n' && quote !== '`') return -1;
  }
  return -1;
}

function readStringLiteral(source: string, index: number): string | null {
  const ch = source[index];
  if (ch !== "'" && ch !== '"' && ch !== '`') return null;
  const end = stringEnd(source, index);
  return end === -1 ? null : source.slice(index + 1, end);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
