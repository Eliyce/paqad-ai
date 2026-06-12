import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { VerificationEvidence } from '@/core/types/verification-evidence';
import {
  buildEvidenceFeed,
  buildPrCommentMarkdown,
  buildReceiptFeed,
  readAiBomDocument,
} from '@/dashboard/trust.js';
import { appendEvidenceRows, buildEvidenceRow } from '@/evidence/ledger.js';
import { projectReceipt } from '@/evidence/receipt/project.js';
import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from '@/verification/evidence';

function row(code: string, verdict: 'pass' | 'fail' = 'pass', ts = '2026-06-11T00:00:00.000Z') {
  return buildEvidenceRow({
    ts,
    engine: 'verification-gate',
    code,
    subject_digest: 'subject-1',
    verdict,
    strength_class: 'deterministic',
  });
}

async function project(root: string, code: string) {
  return projectReceipt({
    projectRoot: root,
    fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
    rows: [row(code)],
    verifierVersion: '1.0.0',
    timeVerified: '2026-06-11T00:00:00.000Z',
  });
}

describe('dashboard trust', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-trust-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('buildEvidenceFeed', () => {
    it('returns an empty feed when no ledger exists', () => {
      const feed = buildEvidenceFeed(root);
      expect(feed.rows).toEqual([]);
      expect(feed.total).toBe(0);
    });

    it('returns rows newest first with gate and verdict filters', () => {
      appendEvidenceRows(root, [
        row('code-tests-lint', 'pass', '2026-06-10T00:00:00.000Z'),
        row('mutation-testing', 'fail', '2026-06-11T00:00:00.000Z'),
        row('code-tests-lint', 'fail', '2026-06-12T00:00:00.000Z'),
      ]);

      const all = buildEvidenceFeed(root);
      expect(all.total).toBe(3);
      expect(all.rows.map((r) => r.ts)).toEqual([
        '2026-06-12T00:00:00.000Z',
        '2026-06-11T00:00:00.000Z',
        '2026-06-10T00:00:00.000Z',
      ]);

      const gated = buildEvidenceFeed(root, { gate: 'code-tests-lint' });
      expect(gated.rows.map((r) => r.code)).toEqual(['code-tests-lint', 'code-tests-lint']);
      expect(gated.total).toBe(3);

      const failed = buildEvidenceFeed(root, { gate: 'code-tests-lint', verdict: 'fail' });
      expect(failed.rows).toHaveLength(1);
      expect(failed.rows[0].ts).toBe('2026-06-12T00:00:00.000Z');
    });

    it('caps rows at the limit and clamps out-of-range limits', () => {
      appendEvidenceRows(root, [
        row('a', 'pass', '2026-06-10T00:00:00.000Z'),
        row('b', 'pass', '2026-06-11T00:00:00.000Z'),
        row('c', 'pass', '2026-06-12T00:00:00.000Z'),
      ]);
      expect(buildEvidenceFeed(root, { limit: 2 }).rows).toHaveLength(2);
      expect(buildEvidenceFeed(root, { limit: 0 }).rows).toHaveLength(1);
      expect(buildEvidenceFeed(root, { limit: 99999 }).rows).toHaveLength(3);
    });
  });

  describe('buildReceiptFeed', () => {
    it('returns an empty feed when no chain exists', () => {
      const feed = buildReceiptFeed(root);
      expect(feed.receipts).toEqual([]);
      expect(feed.brokenAt).toBeNull();
    });

    it('shapes sealed receipt cards newest first from a sound chain', async () => {
      await project(root, 'mutation-testing');
      await project(root, 'spec-review');

      const feed = buildReceiptFeed(root);
      expect(feed.brokenAt).toBeNull();
      expect(feed.receipts).toHaveLength(2);
      // newest first
      expect(feed.receipts[0].index).toBe(1);
      expect(feed.receipts[0].sealed).toBe(true);
      expect(feed.receipts[0].verification_result).toBe('PASSED');
      expect(feed.receipts[0].time_verified).toBe('2026-06-11T00:00:00.000Z');
      expect(feed.receipts[0].checks).toEqual([
        {
          code: 'spec-review',
          engine: 'verification-gate',
          verdict: 'pass',
          strength_class: 'deterministic',
        },
      ]);
      expect(feed.receipts[0].subjects).toEqual([{ name: 'src/a.ts', digest: 'aaa' }]);
      expect(feed.receipts[1].prev_receipt_hash).toMatch(/^0+$/);
    });

    it('marks receipts from the first broken link as unsealed', async () => {
      const first = await project(root, 'mutation-testing');
      // Tamper: append a forged envelope whose prev hash skips the real chain.
      const forged = {
        ...first.envelope,
        paqad: { ...first.envelope.paqad, prev_receipt_hash: 'f'.repeat(64) },
      };
      appendFileSync(
        join(root, PATHS.EVIDENCE_RECEIPT_CHAIN),
        `${JSON.stringify(forged)}\n`,
        'utf8',
      );

      const feed = buildReceiptFeed(root);
      expect(feed.brokenAt).toBe(1);
      expect(feed.receipts[0].sealed).toBe(false); // the forged latest
      expect(feed.receipts[1].sealed).toBe(true); // the genuine genesis
    });
  });

  describe('readAiBomDocument', () => {
    it('returns null when absent or unparseable', () => {
      expect(readAiBomDocument(root)).toBeNull();
      const path = join(root, PATHS.EVIDENCE_AI_BOM);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, '{broken', 'utf8');
      expect(readAiBomDocument(root)).toBeNull();
    });

    it('returns the persisted CycloneDX document', async () => {
      await project(root, 'mutation-testing');
      const doc = readAiBomDocument(root);
      expect(doc?.bomFormat).toBe('CycloneDX');
      expect(doc?.components[0]?.name).toBe('src/a.ts');
    });
  });

  describe('buildPrCommentMarkdown', () => {
    it('returns null before any verification ran', () => {
      expect(buildPrCommentMarkdown(root)).toBeNull();
    });

    it('renders the same Markdown the CLI prints', () => {
      const evidence: VerificationEvidence = {
        schema_version: '1.1.0',
        run_id: 'run-1',
        started_at: '2026-06-01T00:00:00.000Z',
        completed_at: '2026-06-01T00:01:00.000Z',
        overall_status: 'pass',
        first_failure_gate: null,
        gates: [
          {
            name: 'code-tests-lint',
            status: 'pass',
            detail: 'Structured test results show 10/10 passing checks',
            remediation: null,
            failures: [],
          },
        ],
      };
      const path = join(root, VERIFICATION_EVIDENCE_RELATIVE_PATH);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(evidence), 'utf8');

      const markdown = buildPrCommentMarkdown(root, 'abc1234');
      expect(markdown).toMatch(/abc1234/);
      expect(markdown).toMatch(/Tests/);
    });
  });
});
