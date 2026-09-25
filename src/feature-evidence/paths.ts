// Per-feature evidence path layer (issue #339, Phase 1 — dark).
//
// Resolves the one-directory-per-feature layout and round-trips a feature dir
// name to its `{ issue, slug, ulid }` parts. All paths are project-relative (the
// session-ledger convention), so a consumer joins them onto its own project root.
// Nothing here writes; this is the pure path/name layer the later phases build on.

// `pathe` (not node:path) so the returned project-relative paths are posix on every
// platform — the paqad posix-everywhere path contract. These strings are stable keys
// (the feature dir name) and are compared/persisted, so a Windows backslash would
// diverge from the same path minted on macOS/Linux.
import { join } from 'pathe';

import { PATHS } from '@/core/constants/paths.js';
import { ULID_BODY } from '@/core/ids/ulid.js';
import { isSlugSafe } from '@/planning/slug-utils.js';

import type { FeatureDirName } from './types.js';

/** The rigid, script-owned files that make up one feature's bundle. */
export const FEATURE_BUNDLE_FILES = {
  feature: 'feature.json',
  plan: 'plan.json',
  specification: 'specification.json',
  review: 'review.json',
  stageEvidence: 'stage-evidence.jsonl',
  ruleRun: 'rule-run.jsonl',
  // Issue #557 — which rules applied to the change and that their full text was loaded,
  // written by `paqad-ai rules load`. Distinct from rule-run.jsonl (scripted-rule FINDINGS):
  // this records rule LOADING, the half nothing recorded before.
  rulesLoaded: 'rules-loaded.json',
  delivery: 'delivery.json',
  receipt: 'receipt.json',
  aiBom: 'ai-bom.json',
  rag: 'rag.jsonl',
  // Issue #528 — the deterministic check runner's structured report, re-homed out of the
  // global tracked `.paqad/checks/last-run.json` (which churned every commit) into the
  // per-feature bundle so it rides the already-ignored `ledger/` tree like every other
  // stage's evidence.
  checks: 'checks.json',
  // Issue #468, Phase A — the bundle homes the duplication counts, change-metrics
  // ratios, and graded gate rows dual-write into during the parity window (D4/D5).
  duplication: 'duplication.jsonl',
  changeMetrics: 'change-metrics.jsonl',
  evidence: 'evidence.jsonl',
  // Issue #551 — the visual-evidence manifest at the bundle root; the per-step
  // screenshots + overview GIF live under the `screenshots/` subtree (the one
  // structured carve-out in the otherwise flat, text-only bundle).
  visualEvidence: 'visual-evidence.json',
  // Issue #567 — one row per dispatched stage agent under stage isolation: the tokens it
  // used and the carried history the orchestrator did not re-send. Written only when the
  // feature ran under stage isolation, so it is an optional bundle stream.
  contextEfficiency: 'context-efficiency.jsonl',
} as const;

/** The bundle subdirectory holding visual-evidence screenshots + the overview GIF. */
export const SCREENSHOTS_DIR = 'screenshots';

/** A key into {@link FEATURE_BUNDLE_FILES}. */
export type FeatureBundleFile = keyof typeof FEATURE_BUNDLE_FILES;

/** A dir name is issue (jira `PQD-123` or github `123`), a slug, then a ULID. */
const JIRA_ISSUE = '[A-Z][A-Z0-9]*-\\d+';
const GITHUB_ISSUE = '\\d+';
/**
 * `[<issue>-]<slug>-<ULID>`. Anchored on the trailing ULID so the split is
 * deterministic. The optional issue prefix is a jira key or a bare github number
 * followed by `-`; everything between it and the ULID is the slug. A leading bare
 * numeric slug segment (`123-…`) is read as a github issue — the documented
 * tie-break; `feature.json.issue` is the authoritative value regardless.
 */
const DIR_NAME_RE = new RegExp(
  `^(?:(${JIRA_ISSUE}|${GITHUB_ISSUE})-)?([a-z0-9]+(?:-[a-z0-9]+)*)-(${ULID_BODY})$`,
);

/** A standalone issue ref the dir name can carry (jira key or bare github number). */
const ISSUE_RE = new RegExp(`^(?:${JIRA_ISSUE}|${GITHUB_ISSUE})$`);

/** Project-relative container for every feature bundle. */
export function featureEvidenceDir(): string {
  return PATHS.FEATURE_EVIDENCE_DIR;
}

/** Project-relative directory for one feature (its whole bundle). */
export function featureDir(dirName: string): string {
  return join(PATHS.FEATURE_EVIDENCE_DIR, dirName);
}

/** Project-relative path to one of a feature's bundle files. */
/**
 * The change key of a feature bundle: the ULID at the end of its folder name (issue #581,
 * INV-4). It never changes on a rename, so every row and document the bundle holds names the
 * same change. A name that does not parse is returned as-is; the envelope schema rejects it.
 */
export function featureChangeKey(dirName: string): string {
  return parseFeatureDirName(dirName)?.ulid ?? dirName;
}

export function featureFilePath(dirName: string, file: FeatureBundleFile): string {
  return join(featureDir(dirName), FEATURE_BUNDLE_FILES[file]);
}

/**
 * Project-relative path to a feature's rendered `report.html` (issue #371). This is a
 * derived, human-readable projection of the bundle — deliberately NOT a member of
 * {@link FEATURE_BUNDLE_FILES}, so `exportFeatureBundle` never tries to parse it as a
 * bundle JSON. It lives right next to the JSON it renders and, like the rest of the
 * bundle, is git-ignored (the managed `.paqad/.gitignore` `ledger/` line covers it).
 */
export function featureReportPath(dirName: string): string {
  return join(featureDir(dirName), 'report.html');
}

/**
 * Project-relative path to a feature's `screenshots/` subtree (issue #551) — the one
 * structured directory inside the otherwise flat bundle. It holds `overview.gif` and one
 * `NN-slug/{image.png,caption.txt}` dir per captured step. Like the rest of the bundle it is
 * git-ignored by the managed `ledger/` line.
 */
export function featureScreenshotsDir(dirName: string): string {
  return join(featureDir(dirName), SCREENSHOTS_DIR);
}

/**
 * Project-relative path to a feature's rendered `specification.md` (issue #512, Part A) — a
 * derived, human-readable projection of the frozen `specification.json`. Like `report.html`
 * (#371) it is deliberately NOT a member of {@link FEATURE_BUNDLE_FILES}, so
 * `exportFeatureBundle` never parses it as a bundle JSON. It is regenerated on every freeze
 * from the JSON, so it can never drift and is never a second source of truth (the
 * input-deletion contract of #402 stands). It is git-ignored by the managed `ledger/` line,
 * like the rest of the bundle.
 */
export function featureSpecMarkdownPath(dirName: string): string {
  return join(featureDir(dirName), 'specification.md');
}

/** Project-relative path to the per-session control JSON. */
export function featureSessionControlPath(sessionId: string): string {
  return join(PATHS.FEATURE_EVIDENCE_SESSION_DIR, `${sessionId}.json`);
}

/** Project-relative `_chat` home for one session's non-feature activity. */
export function chatDir(sessionId: string): string {
  return join(PATHS.CHAT_LEDGER_DIR, sessionId);
}

/** Project-relative path to a session's `_chat` retrieval ledger. */
export function chatRagPath(sessionId: string): string {
  return join(chatDir(sessionId), FEATURE_BUNDLE_FILES.rag);
}

/**
 * Compose a feature dir name from its parts. The issue (when present) leads, then
 * the slug, then the ULID. Throws on an unsafe slug or malformed ULID so a bad
 * name can never be minted — the dir name is the immutable change key.
 */
export function formatFeatureDirName(parts: FeatureDirName): string {
  if (!isSlugSafe(parts.slug)) {
    throw new Error(`Unsafe feature slug: ${JSON.stringify(parts.slug)}`);
  }
  if (!new RegExp(`^${ULID_BODY}$`).test(parts.ulid)) {
    throw new Error(`Malformed feature ULID: ${JSON.stringify(parts.ulid)}`);
  }
  if (parts.issue !== null && !ISSUE_RE.test(parts.issue)) {
    throw new Error(`Malformed feature issue ref: ${JSON.stringify(parts.issue)}`);
  }
  const prefix = parts.issue ? `${parts.issue}-` : '';
  return `${prefix}${parts.slug}-${parts.ulid}`;
}

/** Parse a feature dir name into its parts, or `null` when it is not one. */
export function parseFeatureDirName(dirName: string): FeatureDirName | null {
  const match = DIR_NAME_RE.exec(dirName);
  if (!match) {
    return null;
  }
  return { issue: match[1] ?? null, slug: match[2]!, ulid: match[3]! };
}

/** True when `dirName` is a well-formed feature dir name. */
export function isFeatureDirName(dirName: string): boolean {
  return parseFeatureDirName(dirName) !== null;
}
