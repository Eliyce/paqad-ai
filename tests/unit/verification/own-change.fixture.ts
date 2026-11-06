import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { startStage } from '@/stage-evidence/recorder.js';

import { commitAll, git, makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';

const roots: string[] = [];

export const RULE_REPORT = '.paqad/scripts/rules/.cache/report.json';

export const OPENED_AT = new Date('2026-03-01T09:00:00.000Z');
export const TURN = '2026-03-01T10:00:00.000Z';
export const IN_TURN = new Date('2026-03-01T10:05:00.000Z');

export function cleanupOwnChanges(): void {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
}

export function ownChangeRepo(
  session: string,
  branch = 'feat/own',
  beforeOpen: (root: string) => void = () => {},
): { root: string; dir: string } {
  const root = makeEmptyRepo('main');
  roots.push(root);
  writeRepoFile(root, 'a.ts', 'export const a = 1;\n');
  writeRepoFile(root, 'b.ts', 'export const b = 1;\n');
  commitAll(root, 'chore: base');
  git(root, ['switch', '-q', '-c', branch]);
  beforeOpen(root);
  const dir = openFeatureChange(root, session, {
    adapter: 'claude-code',
    title: 'own change',
    issue: null,
    now: () => OPENED_AT,
  });
  startStage(root, 'planning', {
    sessionId: session,
    dirName: dir,
    adapter: 'claude-code',
    now: () => OPENED_AT,
  });
  writeWorkflowState(root, session, {
    active: { workflow: 'feature-development' },
    paused: [],
    turn_started_at: TURN,
  });
  return { root, dir };
}

export function writeRuleReport(root: string, ...files: string[]): void {
  const target = join(root, RULE_REPORT);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({
      results: [
        {
          rule_id: 'RL-6740',
          script: 'a.mjs',
          kind: 'deterministic',
          findings: files.map((file) => ({ file, line: 3, message: 'broken', severity: 'high' })),
        },
      ],
    }),
  );
}

export function writeFailingChecks(root: string, file: string): void {
  const target = join(root, PATHS.CHECKS_REPORT);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({
      schema_version: 1,
      generated_at: '2026-07-21T00:00:00.000Z',
      passed: false,
      ran: true,
      results: [
        {
          summary: { total: 2, passed: 1, failed: 1, skipped: 0, errored: 0, runner_id: 'test' },
          failures: [{ test_id: 't', message: 'boom', file_path: file, line_number: 4 }],
        },
      ],
    }),
  );
}
