import { join } from 'pathe';

import { PATHS } from '@/core/constants/paths.js';
import { ULID_BODY } from '@/core/ids/ulid.js';
import { isSlugSafe } from '@/planning/slug-utils.js';

import type { FeatureDirName } from './types.js';

export const FEATURE_BUNDLE_FILES = {
  feature: 'feature.json',
  plan: 'plan.json',
  specification: 'specification.json',
  review: 'review.json',
  stageEvidence: 'stage-evidence.jsonl',
  ruleRun: 'rule-run.jsonl',
  rulesLoaded: 'rules-loaded.json',
  delivery: 'delivery.json',
  receipt: 'receipt.json',
  aiBom: 'ai-bom.json',
  rag: 'rag.jsonl',
  checks: 'checks.json',
  duplication: 'duplication.jsonl',
  changeMetrics: 'change-metrics.jsonl',
  evidence: 'evidence.jsonl',
  visualEvidence: 'visual-evidence.json',
  specMd: 'spec.md',
  request: 'request.md',
  clarification: 'clarification.json',
  experts: 'experts.json',
  highTable: 'high-table.jsonl',
  cost: 'cost.json',
  decisions: 'decisions.json',
} as const;

export const LEGACY_BUNDLE_FILES = {
  specificationMd: 'specification.md',
  contextEfficiency: 'context-efficiency.jsonl',
} as const;

export const SCREENSHOTS_DIR = 'screenshots';

export type FeatureBundleFile = keyof typeof FEATURE_BUNDLE_FILES;

const JIRA_ISSUE = '[A-Z][A-Z0-9]*-\\d+';
const GITHUB_ISSUE = '\\d+';
const DIR_NAME_RE = new RegExp(
  `^(?:(${JIRA_ISSUE}|${GITHUB_ISSUE})-)?([a-z0-9]+(?:-[a-z0-9]+)*)-(${ULID_BODY})$`,
);

const ISSUE_RE = new RegExp(`^(?:${JIRA_ISSUE}|${GITHUB_ISSUE})$`);

export function featureEvidenceDir(): string {
  return PATHS.FEATURE_EVIDENCE_DIR;
}

export function featureDir(dirName: string): string {
  return join(PATHS.FEATURE_EVIDENCE_DIR, dirName);
}

export function featureChangeKey(dirName: string): string {
  return parseFeatureDirName(dirName)?.ulid ?? dirName;
}

export function featureFilePath(dirName: string, file: FeatureBundleFile): string {
  return join(featureDir(dirName), FEATURE_BUNDLE_FILES[file]);
}

export function featureReportPath(dirName: string): string {
  return join(featureDir(dirName), 'report.html');
}

export function featureScreenshotsDir(dirName: string): string {
  return join(featureDir(dirName), SCREENSHOTS_DIR);
}

export function featureLegacySpecMarkdownPath(dirName: string): string {
  return join(featureDir(dirName), LEGACY_BUNDLE_FILES.specificationMd);
}

export function featureSessionControlPath(sessionId: string): string {
  return join(PATHS.FEATURE_EVIDENCE_SESSION_DIR, `${sessionId}.json`);
}

export function chatDir(sessionId: string): string {
  return join(PATHS.CHAT_LEDGER_DIR, sessionId);
}

export function chatRagPath(sessionId: string): string {
  return join(chatDir(sessionId), FEATURE_BUNDLE_FILES.rag);
}

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

export function parseFeatureDirName(dirName: string): FeatureDirName | null {
  const match = DIR_NAME_RE.exec(dirName);
  if (!match) {
    return null;
  }
  return { issue: match[1] ?? null, slug: match[2]!, ulid: match[3]! };
}

export function isFeatureDirName(dirName: string): boolean {
  return parseFeatureDirName(dirName) !== null;
}
