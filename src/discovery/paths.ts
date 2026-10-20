import { join } from 'pathe';

import { PATHS } from '@/core/constants/paths.js';
import { ULID_BODY } from '@/core/ids/ulid.js';
import { isSlugSafe } from '@/planning/slug-utils.js';

export interface DiscoveryRunDirName {
  issue: string | null;
  slug: string;
  ulid: string;
}

export const DISCOVERY_RUN_FILES = {
  run: 'run.json',
  brief: 'brief.json',
  sources: 'sources.jsonl',
  contributions: 'contributions.jsonl',
  synthesis: 'synthesis.json',
  decisions: 'decisions.json',
  readiness: 'readiness.json',
  handoff: 'handoff.json',
  stageEvidence: 'stage-evidence.jsonl',
  contextReceipts: 'context-receipts.jsonl',
  blockers: 'blockers.jsonl',
} as const;

export type DiscoveryRunFile = keyof typeof DISCOVERY_RUN_FILES;

const JIRA_ISSUE = '[A-Z][A-Z0-9]*-\\d+';
const GITHUB_ISSUE = '\\d+';
const DIR_NAME_RE = new RegExp(
  `^(?:(${JIRA_ISSUE}|${GITHUB_ISSUE})-)?([a-z0-9]+(?:-[a-z0-9]+)*)-(${ULID_BODY})$`,
);

const ISSUE_RE = new RegExp(`^(?:${JIRA_ISSUE}|${GITHUB_ISSUE})$`);

export function discoveryDir(): string {
  return PATHS.DISCOVERY_DIR;
}

export function discoveryRunDir(dirName: string): string {
  return join(PATHS.DISCOVERY_DIR, dirName);
}

export function discoveryRunFilePath(dirName: string, file: DiscoveryRunFile): string {
  return join(discoveryRunDir(dirName), DISCOVERY_RUN_FILES[file]);
}

export function discoveryReportPath(dirName: string): string {
  return join(discoveryRunDir(dirName), 'report.html');
}

export function discoveryRunChangeKey(dirName: string): string {
  return parseDiscoveryRunDirName(dirName)?.ulid ?? dirName;
}

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

export function parseDiscoveryRunDirName(dirName: string): DiscoveryRunDirName | null {
  const match = DIR_NAME_RE.exec(dirName);
  if (!match) {
    return null;
  }
  return { issue: match[1] ?? null, slug: match[2]!, ulid: match[3]! };
}

export function isDiscoveryRunDirName(dirName: string): boolean {
  return parseDiscoveryRunDirName(dirName) !== null;
}
