import { join } from 'node:path';

export const RULES_DISCOVERY_DIR = '.paqad/ledger/rules-discovery';
export const RULES_DISCOVERY_BASELINE = `${RULES_DISCOVERY_DIR}/baseline.json`;
export const RULES_DISCOVERY_NUDGE_STATE = '.paqad/rules-discovery-nudge.json';
export const STACK_SNAPSHOT_PATH = '.paqad/stack-snapshot.json';
export const RULES_ROOT = 'docs/instructions/rules';
export const PROJECT_RULES_DIR = `${RULES_ROOT}/project`;

export const RUN_FILES = {
  run: 'run.json',
  inventory: 'stack-inventory.json',
  fromDecisions: 'from-decisions.json',
  fromResearch: 'from-research.json',
  research: 'research.json',
  sources: 'sources.json',
  proposal: 'proposal.json',
  proposalMarkdown: 'proposal.md',
  apply: 'apply.json',
  report: 'report.json',
} as const;

export type RunFile = keyof typeof RUN_FILES;

const RUN_ID_RE = /^rd-\d{8}-\d{6}(?:-[a-z0-9]{1,8})?$/;

export function isRunId(value: string): boolean {
  return RUN_ID_RE.test(value);
}

export function mintRunId(now: Date, suffix?: string): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return suffix === undefined ? `rd-${stamp}` : `rd-${stamp}-${suffix}`;
}

export function runDirPath(runId: string): string {
  if (!isRunId(runId)) {
    throw new Error(`invalid rules discovery run id "${runId}"`);
  }
  return `${RULES_DISCOVERY_DIR}/${runId}`;
}

export function runFilePath(runId: string, file: RunFile): string {
  return `${runDirPath(runId)}/${RUN_FILES[file]}`;
}

export function absRunFile(projectRoot: string, runId: string, file: RunFile): string {
  return join(projectRoot, runFilePath(runId, file));
}
