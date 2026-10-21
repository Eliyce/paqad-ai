import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';
import type { VerificationGate } from '@/core/types/verification.js';
import type {
  VerificationEvidence,
  VerificationEvidenceGate,
} from '@/core/types/verification-evidence.js';
import { ZERO_DIGEST } from '@/evidence/digests.js';
import { evidenceGatesToRows } from '@/evidence/fan-in.js';
import { signReceipt } from '@/evidence/receipt/dsse.js';
import { buildInTotoStatement, summarizeGradedEvidence } from '@/evidence/receipt/statement.js';
import { appendFeatureEvidenceRows } from '@/feature-evidence/bundle-ledgers.js';
import { renderFeatureReportHtml } from '@/feature-evidence/report.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { buildHudSnapshot } from '@/hud/snapshot.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { foldRowsWithKey } from '@/stage-evidence/fold.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import { renderEvidenceMarkdown } from '@/verification/evidence-markdown.js';
import { composeChangeReceipt } from '@/verification/repository/receipt.js';
import { buildRepositoryVerificationVerdict } from '@/verification/repository/verdict.js';

import { ownInFlightChange } from './shared.fixture.js';

const AT = '2026-10-19T12:00:00.000Z';
const SES = 'ses-ord-482';
const RAN = 3;

function gate(
  name: string,
  status: VerificationEvidenceGate['status'],
  detail: string,
  extra: Partial<VerificationEvidenceGate> = {},
): VerificationEvidenceGate {
  return {
    name: name as VerificationGate,
    status,
    detail,
    remediation: null,
    failures: [],
    ...extra,
  };
}

const ORD_482_GATES: VerificationEvidenceGate[] = [
  gate('change-completeness', 'pass', 'Change completeness: complete.'),
  gate('ac-test-mapping', 'pass', 'All 4 automated acceptance criteria map to a proving test.'),
  gate('code-tests-lint', 'pass', 'Structured test results show 41/41 passing checks.'),
  gate('visual-evidence', 'skipped', 'not-frontend: no changed file matched a frontend surface.', {
    skip_reason: 'not-frontend',
    skip_kind: 'not-required',
  }),
  gate('mutation-testing', 'skipped', 'Mutation testing is off (mutation_mode is off).', {
    skip_kind: 'not-required',
  }),
  gate(
    'quality-ratchet',
    'skipped',
    'Quality ratchet did not run: no quality measure could be taken (blocked: strictness).',
    { skip_kind: 'did-not-run' },
  ),
];

const EVIDENCE: VerificationEvidence = {
  schema_version: '1.1.0',
  run_id: 'ord-482',
  started_at: AT,
  completed_at: AT,
  overall_status: 'pass',
  first_failure_gate: null,
  gates: ORD_482_GATES,
};

const ROWS = evidenceGatesToRows(ORD_482_GATES, { subjectDigest: 'sha-ord-482', ts: AT });

describe('ORD-482: every surface counts only the required gates that ran', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-ord-482-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-12: verdict summary, receipt statement, PR comment, report.html receipt and HUD gates agree on the counts', () => {
    const verdict = buildRepositoryVerificationVerdict({
      origin: 'hook-completion',
      evidence: EVIDENCE,
      escalations: [],
      evidencePath: null,
      flagOnGates: ['visual-evidence' as VerificationGate],
    });
    const receipt = composeChangeReceipt({ verdictSummary: verdict.summary, fold: null });
    for (const text of [verdict.summary, receipt]) {
      expect(text).toContain(PAQAD_VERDICT.pass);
      expect(text).toContain(`${RAN}/${RAN} checks held`);
      expect(text).toContain('⚪ visual evidence: not required (not-frontend)');
      expect(text).toContain('⚪ quality ratchet: Quality ratchet did not run');
    }

    const graded = summarizeGradedEvidence(ROWS);
    expect(graded.deterministic.pass).toBe(RAN);
    expect(graded.deterministic.fail + graded.llm_judged.pass + graded.llm_judged.fail).toBe(0);
    expect(graded.inconclusive + graded.blocked).toBe(0);

    const comment = renderEvidenceMarkdown(EVIDENCE);
    expect(comment).toContain(
      `Gates: ${RAN} passed, 0 failed, 0 inconclusive, 2 not required, 1 did not run.`,
    );
    expect(comment).not.toContain('Mutation');
    expect(comment).toContain('⚪ Quality ratchet: Quality ratchet did not run');

    const statement = buildInTotoStatement({
      fileDigests: [{ name: 'src/orders/total.ts', sha256: 'abc123' }],
      rows: ROWS,
      verifierVersion: '1.99.3',
      timeVerified: AT,
    });
    expect(statement.predicate.verification_result).toBe('PASSED');
    const html = renderFeatureReportHtml(
      {
        dir_name: '482-order-total-rounding-01M5AKZA1VKCCXZME19M5YRVZT',
        exported_at: AT,
        files: {
          receipt: signReceipt({ statement, prevReceiptHash: ZERO_DIGEST, mode: 'hash-chained' }),
        },
      },
      foldRowsWithKey([] as SessionLedgerRow[], {
        sessionId: SES,
        changeKey: '482-order-total-rounding-01M5AKZA1VKCCXZME19M5YRVZT',
        promptOrdinal: 0,
      }),
      { generatedAt: AT, verdict: 'pass' },
    );
    const tableStart = html.indexOf('<table class="gates">');
    const receiptPanel = html.slice(tableStart, html.indexOf('</table>', tableStart));
    const cells = [
      ...receiptPanel.matchAll(/<tr><td><code>([^<]+)<\/code><\/td><td>([^<]+)<\/td>/g),
    ].map((m) => [m[1], m[2]?.trim()]);
    expect(cells).toEqual([
      ['change-completeness', '🟢 pass'],
      ['ac-test-mapping', '🟢 pass'],
      ['code-tests-lint', '🟢 pass'],
      ['visual-evidence', '⚪ not required'],
      ['mutation-testing', '⚪ not required'],
      ['quality-ratchet', '⚪ did not run'],
    ]);
    expect(receiptPanel).not.toContain('🟡');

    const sessionId = resolveSessionId(root, SES);
    const dir = openFeatureChange(root, sessionId, {
      adapter: 'claude-code',
      title: 'order total rounding',
      issue: '482',
    });
    ownInFlightChange(root, sessionId, dir);
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'feature-development' },
      paused: [],
    });
    for (const stage of ['development', 'checks']) {
      const ctx = { sessionId, dirName: dir, adapter: 'claude-code', now: () => new Date(0) };
      startStage(root, stage, ctx);
      endStage(root, stage, {}, ctx);
    }
    appendFeatureEvidenceRows(root, sessionId, ROWS);
    const hud = buildHudSnapshot(root, SES, { now: () => new Date(AT) });
    const ran = hud.gates.filter(
      (g) => g.required && ['pass', 'fail', 'inconclusive'].includes(g.verdict),
    );
    expect(ran).toHaveLength(RAN);
    expect(hud.gates.filter((g) => g.verdict === 'not-required').map((g) => g.name)).toEqual([
      'visual-evidence',
      'mutation-testing',
    ]);
    expect(hud.gates.filter((g) => g.verdict === 'not-required').every((g) => !g.required)).toBe(
      true,
    );
    expect(hud.gates.find((g) => g.name === 'quality-ratchet')).toMatchObject({
      verdict: 'did-not-run',
      required: true,
    });
  });
});
