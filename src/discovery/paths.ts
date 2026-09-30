// Discovery run path + dir-name layer (issue #597).
//
// Resolves the one-directory-per-run layout under `.paqad/ledger/delivery/` and round-trips a run
// dir name to its `{ issue, slug, ulid }` parts. Mirrors src/feature-evidence/paths.ts (a different
// root and doc family, the same immutable-change-key discipline). Nothing here writes; this is the
// pure path/name layer the writers, recorder, and report build on.
//
// `pathe` (not node:path) so the returned project-relative paths are posix on every platform — the
// paqad posix-everywhere contract. The run dir name is a stable key (it is the change key) and is
// compared/persisted, so a Windows backslash would diverge from the same path minted elsewhere.

import { join } from 'pathe';

import { PATHS } from '@/core/constants/paths.js';
import { ULID_BODY } from '@/core/ids/ulid.js';
import { isSlugSafe } from '@/planning/slug-utils.js';

/** A Discovery run dir name split into its parts. */
export interface DiscoveryRunDirName {
  /** A jira key (`PQD-123`) or bare github number (`597`), or null when the run carries none. */
  issue: string | null;
  slug: string;
  ulid: string;
}

/** The rigid, script-owned files that make up one Discovery run. */
export const DISCOVERY_RUN_FILES = {
  /** Run identity + lifecycle: workflow, project, owning session, revision, status, outcome. */
  run: 'run.json',
  /** Understand: the correctable brief. */
  brief: 'brief.json',
  /** Investigate: attributable research source references (append-only). */
  sources: 'sources.jsonl',
  /** Reusable-expert contributions (append-only). */
  contributions: 'contributions.jsonl',
  /** Chief synthesis of the contributions. */
  synthesis: 'synthesis.json',
  /** Decide: the run's index of settled Discovery-owned decision ids. */
  decisions: 'decisions.json',
  /** Check readiness: the outcome-specific readiness verdict. */
  readiness: 'readiness.json',
  /** Hand off: the durable owner summary + next action + authorization. */
  handoff: 'handoff.json',
  /** Discovery stage-evidence rows (own doc type, own stage set). */
  stageEvidence: 'stage-evidence.jsonl',
  /** Stage-local context load receipts (append-only). */
  contextReceipts: 'context-receipts.jsonl',
  /** Recorded blockers (append-only). */
  blockers: 'blockers.jsonl',
} as const;

/** A key into {@link DISCOVERY_RUN_FILES}. */
export type DiscoveryRunFile = keyof typeof DISCOVERY_RUN_FILES;

const JIRA_ISSUE = '[A-Z][A-Z0-9]*-\\d+';
const GITHUB_ISSUE = '\\d+';
/** `[<issue>-]<slug>-<ULID>`, anchored on the trailing ULID for a deterministic split. */
const DIR_NAME_RE = new RegExp(
  `^(?:(${JIRA_ISSUE}|${GITHUB_ISSUE})-)?([a-z0-9]+(?:-[a-z0-9]+)*)-(${ULID_BODY})$`,
);

/** A standalone issue ref a run dir name can carry (jira key or bare github number). */
const ISSUE_RE = new RegExp(`^(?:${JIRA_ISSUE}|${GITHUB_ISSUE})$`);

/** Project-relative container for every Discovery run. */
export function discoveryDir(): string {
  return PATHS.DISCOVERY_DIR;
}

/** Project-relative directory for one Discovery run (its whole record). */
export function discoveryRunDir(dirName: string): string {
  return join(PATHS.DISCOVERY_DIR, dirName);
}

/** Project-relative path to one of a run's rigid files. */
export function discoveryRunFilePath(dirName: string, file: DiscoveryRunFile): string {
  return join(discoveryRunDir(dirName), DISCOVERY_RUN_FILES[file]);
}

/**
 * Project-relative path to a run's rendered `report.html`. A derived, human-readable projection —
 * deliberately NOT a member of {@link DISCOVERY_RUN_FILES} — that lives next to the JSON it renders
 * and, like the rest of the run, is git-ignored by the managed `ledger/` line.
 */
export function discoveryReportPath(dirName: string): string {
  return join(discoveryRunDir(dirName), 'report.html');
}

/**
 * The change key of a run: the ULID at the end of its folder name. It never changes on a rename, so
 * every row and document the run holds names the same run. A name that does not parse is returned
 * as-is; the envelope schema rejects it.
 */
export function discoveryRunChangeKey(dirName: string): string {
  return parseDiscoveryRunDirName(dirName)?.ulid ?? dirName;
}

/**
 * Compose a run dir name from its parts: the issue (when present) leads, then the slug, then the
 * ULID. Throws on an unsafe slug or malformed ULID/issue so a bad name can never be minted — the
 * dir name is the immutable change key.
 */
export function formatDiscoveryRunDirName(parts: DiscoveryRunDirName): string {
  if (!isSlugSafe(parts.slug)) {
    throw new Error(`Unsafe Discovery run slug: ${JSON.stringify(parts.slug)}`);
  }
  if (!new RegExp(`^${ULID_BODY}$`).test(parts.ulid)) {
    throw new Error(`Malformed Discovery run ULID: ${JSON.stringify(parts.ulid)}`);
  }
  if (parts.issue !== null && !ISSUE_RE.test(parts.issue)) {
    throw new Error(`Malformed Discovery run issue ref: ${JSON.stringify(parts.issue)}`);
  }
  const prefix = parts.issue ? `${parts.issue}-` : '';
  return `${prefix}${parts.slug}-${parts.ulid}`;
}

/** Parse a run dir name into its parts, or null when it is not one. */
export function parseDiscoveryRunDirName(dirName: string): DiscoveryRunDirName | null {
  const match = DIR_NAME_RE.exec(dirName);
  if (!match) {
    return null;
  }
  return { issue: match[1] ?? null, slug: match[2]!, ulid: match[3]! };
}

/** True when `dirName` is a well-formed Discovery run dir name. */
export function isDiscoveryRunDirName(dirName: string): boolean {
  return parseDiscoveryRunDirName(dirName) !== null;
}
