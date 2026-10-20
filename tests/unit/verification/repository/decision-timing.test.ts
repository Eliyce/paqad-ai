import { mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import { DecisionStore } from '@/planning/decision-store.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { startStage } from '@/stage-evidence/recorder.js';
import {
  buildRepositoryVerificationContext,
  lastSourceEditAt,
} from '@/verification/repository/repository-context.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { seedGitChangedFiles } from '../../pipeline/changed-files.fixture.js';

const SES = 'ses_decision_timing';
const DECISION = 'D-01J000000000000000000000B2';
const EDIT = '2026-05-01T10:00:00.000Z';
const BEFORE_EDIT = '2026-05-01T09:00:00.000Z';
const AFTER_EDIT = '2026-05-01T11:00:00.000Z';

const roots: string[] = [];
beforeEach(() => {
  vi.stubEnv('CLAUDE_SESSION_ID', SES);
});
afterEach(() => {
  vi.unstubAllEnvs();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function packet(createdAt: string): DecisionPacket {
  return {
    decision_id: DECISION,
    fingerprint: 'sha256:timing',
    category: 'component-reuse',
    question: 'Use the Button we have?',
    context: 'Adding a dashboard action.',
    options: [
      {
        option_key: 'reuse-button',
        label: 'Reuse Button',
        one_line_preview: 'If you pick this, we will update src/components/Button.tsx.',
        trade_off: 'You give up: a fresh design.',
        evidence: { file: 'src/components/Button.tsx', callers: 3, similarity: 0.9 },
      },
      {
        option_key: 'make-new',
        label: 'Make new Button',
        one_line_preview: 'If you pick this, we will create src/components/ButtonV2.tsx.',
        trade_off: 'You give up: one shared place.',
        evidence: { file: 'src/components/ButtonV2.tsx', evidence_partial: true },
      },
    ],
    confidence: 0.72,
    requested_by: 'claude-code',
    task_session_id: SES,
    created_at: createdAt,
    status: 'pending',
    ttl_until: '2099-12-31T12:00:00Z',
    invalidation_watch: [],
  } as DecisionPacket;
}

function project(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-decision-timing-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  seedGitChangedFiles(root, ['src/feature.ts']);
  persistLedgerSessionId(root, SES);
  const dir = openFeatureChange(root, SES, {
    adapter: 'claude-code',
    title: 'decision timing',
    issue: null,
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ7',
  });
  startStage(root, 'development', {
    sessionId: SES,
    dirName: dir,
    adapter: 'claude-code',
    now: () => new Date(EDIT),
  });
  return { root, dir };
}

async function verifyWith(createdAt: string) {
  const { root } = project();
  new DecisionStore(root).writePending(packet(createdAt));
  const { context } = await buildRepositoryVerificationContext({
    projectRoot: root,
    origin: 'hook-completion',
  });
  const verdict = await runRepositoryVerification({
    projectRoot: root,
    origin: 'hook-completion',
    prebuiltContext: { context, escalations: [] },
    hostSessionId: SES,
  });
  const review = verdict.gates.find((gate) => gate.gate === 'implementation-review');
  return { context, verdict, review };
}

describe('end-of-change verification judges decisions by when they were opened', () => {
  it('lists a decision opened after the last source edit as waiting, not as a blocker', async () => {
    const { context, verdict, review } = await verifyWith(AFTER_EDIT);

    expect(context.implementation_review_passed).toBe(true);
    expect(context.implementation_review_findings).toEqual([]);
    expect(review?.status).not.toBe('fail');
    const line = `a decision is waiting for you: ${DECISION} (component-reuse): Use the Button we have?`;
    expect(verdict.summary).toContain(line);
    expect(verdict.receipt).toContain(line);
  });

  it('blocks on a decision opened before the last source edit', async () => {
    const { context, verdict, review } = await verifyWith(BEFORE_EDIT);

    expect(context.implementation_review_passed).toBe(false);
    expect(context.implementation_review_findings?.[0]).toMatchObject({
      kind: 'decision-violation',
      decision_id: DECISION,
    });
    expect(context.waiting_decisions).toEqual([]);
    expect(review?.status).toBe('fail');
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).not.toContain('a decision is waiting for you');
  });
});

describe('lastSourceEditAt', () => {
  it('reads the latest development row of the bundle first', async () => {
    const { root, dir } = project();
    expect(await lastSourceEditAt(root, dir, ['src/feature.ts'])).toBe(EDIT);
  });

  it('falls back to the newest changed-file time when the bundle has no development row', async () => {
    const { root } = project();
    const at = new Date('2026-04-01T08:00:00.000Z');
    utimesSync(join(root, 'src/feature.ts'), at, at);
    expect(await lastSourceEditAt(root, null, ['src/feature.ts', 'src/gone.ts'])).toBe(
      at.toISOString(),
    );
  });

  it('is unknown when neither a development row nor a changed file can be read', async () => {
    const { root } = project();
    expect(await lastSourceEditAt(root, null, ['src/gone.ts'])).toBeNull();
    expect(await lastSourceEditAt(root, null, [])).toBeNull();
  });
});
