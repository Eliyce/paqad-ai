import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { writeHudReceipt } from '@/hud/receipt-file.js';
import { appendRouteTurn, type RouteTurn } from '@/pipeline/route-turns.js';
import type { RoutedWorkflow } from '@/pipeline/routed-workflow.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';

const roots: string[] = [];

export function cleanupScopeFixtures(): void {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

export function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

export function plainRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-hud-scope-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.FRAMEWORK_PATH), '~/.paqad-ai/current\n');
  return root;
}

export function initGit(root: string, branch = 'main'): void {
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'checkout', '-q', '-b', branch);
  commit(root, 'README.md', 'first');
}

export function repoRoot(branch = 'main'): string {
  const root = plainRoot();
  writeFileSync(join(root, '.gitignore'), '.paqad/\n');
  initGit(root, branch);
  return root;
}

export function commit(root: string, file: string, message: string): string {
  writeFileSync(join(root, file), `${message}\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

export function checkout(root: string, branch: string, create = false): void {
  git(root, 'checkout', '-q', ...(create ? ['-b', branch] : [branch]));
}

export function setRoute(
  root: string,
  session: string,
  workflow: RoutedWorkflow,
  turnStartedAt?: string,
): void {
  writeWorkflowState(root, session, {
    active: { workflow, lane: 'full', reason: `on ${workflow}` },
    paused: [],
    ...(turnStartedAt ? { turn_started_at: turnStartedAt } : {}),
  });
}

export function logTurns(root: string, session: string, turns: RouteTurn[]): void {
  for (const turn of turns) appendRouteTurn(root, session, turn);
}

export function openChangeHere(
  root: string,
  session: string,
  title = 'ORD-1 scoped change',
  lane: 'fast' | 'graduated' | 'full' = 'full',
  openedAt?: Date,
): string {
  const dir = openFeatureChange(root, session, {
    adapter: 'claude-code',
    title,
    issue: title.split(' ')[0]!,
    lane,
    ...(openedAt ? { now: () => openedAt } : {}),
  });
  persistLedgerSessionId(root, session);
  setRoute(root, session, 'feature-development');
  return dir;
}

export function runStage(root: string, session: string, stage: string): void {
  startStage(root, stage, { sessionId: session, adapter: 'claude-code' });
  endStage(root, stage, { artifactPaths: [] }, { sessionId: session, adapter: 'claude-code' });
}

export function startOnly(root: string, session: string, stage: string): void {
  startStage(root, stage, { sessionId: session, adapter: 'claude-code' });
}

export function writeVerdict(
  root: string,
  session: string,
  kind: 'pass' | 'fail' | 'inconclusive',
  at: Date,
): void {
  writeHudReceipt(
    root,
    session,
    { summary: 'receipt', receipt: 'receipt', gates: [], kind },
    () => at,
  );
}

export function writeGateRows(
  root: string,
  dir: string,
  rows: Array<{ code: string; verdict: string; at: string }>,
): void {
  writeFileSync(
    join(root, featureFilePath(dir, 'evidence')),
    rows
      .map((row) =>
        JSON.stringify({
          schema_version: 2,
          doc_type: 'paqad.evidence',
          recorded_at: row.at,
          engine: 'verification-gate',
          code: row.code,
          subject_digest: 'sd',
          verdict: row.verdict,
          strength_class: 'deterministic',
          content_hash: `h-${row.code}-${row.verdict}-${row.at}`,
          detail: `${row.code} ${row.verdict}`,
        }),
      )
      .join('\n') + '\n',
  );
}

export function later(ms = 60_000): Date {
  return new Date(Date.now() + ms);
}
