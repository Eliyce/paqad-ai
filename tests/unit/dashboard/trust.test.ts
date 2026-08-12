import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ComplianceCitation,
  EvidenceLedgerRow,
  ReceiptEnvelope,
  ReproducibilityStampPredicate,
} from '@/core/types/evidence-ledger.js';
import type { VerificationEvidence } from '@/core/types/verification-evidence';
import {
  buildEvidenceFeed,
  buildPrCommentMarkdown,
  buildReceiptFeed,
  readAiBomDocument,
} from '@/dashboard/trust.js';
import { buildEvidenceRow } from '@/evidence/ledger.js';
import { featureFilePath, formatFeatureDirName } from '@/feature-evidence/paths.js';
import { projectFeatureReceipt } from '@/feature-evidence/receipt.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
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

/**
 * Issue #468 Phase B — the Trust surface projects from the per-feature bundles. Seed graded
 * rows straight into a bundle's `evidence.jsonl` (a single dir; the feed only reverses the
 * append order it reads), and receipts via `projectFeatureReceipt` into DISTINCT features.
 */
function seedBundleEvidence(root: string, rows: EvidenceLedgerRow[]): void {
  const dir = formatFeatureDirName({ issue: null, slug: 'x', ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
  const path = join(root, featureFilePath(dir, 'evidence'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
}

let seed = 0;
function projectFeature(
  root: string,
  opts: {
    code: string;
    ts?: string;
    compliance?: ComplianceCitation[];
    reproducibility?: ReproducibilityStampPredicate;
  },
): string {
  seed += 1;
  const ts = opts.ts ?? '2026-06-11T00:00:00.000Z';
  const dir = openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title: `f${seed}`,
    issue: null,
    ulidSeed: seed,
  });
  projectFeatureReceipt(root, dir, {
    fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
    rows: [row(opts.code, 'pass', ts)],
    verifierVersion: '1.0.0',
    timeVerified: ts,
    ...(opts.compliance ? { complianceCitations: opts.compliance } : {}),
    ...(opts.reproducibility ? { reproducibility: opts.reproducibility } : {}),
  });
  return dir;
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
      seedBundleEvidence(root, [
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
      seedBundleEvidence(root, [
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
    it('returns an empty feed when no receipts exist', () => {
      const feed = buildReceiptFeed(root);
      expect(feed.receipts).toEqual([]);
      expect(feed.brokenAt).toBeNull();
    });

    it('shapes sealed receipt cards newest first from the bundle union', () => {
      projectFeature(root, { code: 'mutation-testing', ts: '2026-06-11T00:00:00.000Z' });
      projectFeature(root, { code: 'spec-review', ts: '2026-06-11T01:00:00.000Z' });

      const feed = buildReceiptFeed(root);
      expect(feed.brokenAt).toBeNull();
      expect(feed.receipts).toHaveLength(2);
      // Newest first by time_verified; each per-feature receipt is its own genesis.
      expect(feed.receipts[0].index).toBe(0);
      expect(feed.receipts[0].sealed).toBe(true);
      expect(feed.receipts[0].verification_result).toBe('PASSED');
      expect(feed.receipts[0].time_verified).toBe('2026-06-11T01:00:00.000Z');
      expect(feed.receipts[0].checks).toEqual([
        {
          code: 'spec-review',
          engine: 'verification-gate',
          verdict: 'pass',
          strength_class: 'deterministic',
        },
      ]);
      expect(feed.receipts[0].subjects).toEqual([{ name: 'src/a.ts', digest: 'aaa' }]);
      // Both are genesis receipts (self-chained per feature), so both prev hashes are zero.
      expect(feed.receipts[0].prev_receipt_hash).toMatch(/^0+$/);
      expect(feed.receipts[1].prev_receipt_hash).toMatch(/^0+$/);
    });

    it('surfaces compliance citations and the reproducibility stamp on the card (#122/#123)', () => {
      projectFeature(root, {
        code: 'mutation-testing',
        compliance: [
          {
            framework_id: 'eu-ai-act',
            framework_title: 'EU AI Act',
            clause_id: 'Art.15',
            clause_title: 'Robustness',
            gate: 'mutation-testing',
            relation: 'subset-of',
            evidence_strength: 'partial',
            disclaimer: 'Evidence toward, not compliance.',
          },
        ],
        reproducibility: {
          context_hash: 'deadbeef',
          determinism: 'input-replay',
          algo_version: 1,
          replayable: true,
        },
      });

      const card = buildReceiptFeed(root).receipts[0];
      expect(card.compliance).toHaveLength(1);
      expect(card.compliance[0].clause_id).toBe('Art.15');
      expect(card.reproducibility?.determinism).toBe('input-replay');
      expect(card.reproducibility?.context_hash).toBe('deadbeef');
    });

    it('defaults compliance to [] and reproducibility to null when absent', () => {
      projectFeature(root, { code: 'mutation-testing' });
      const card = buildReceiptFeed(root).receipts[0];
      expect(card.compliance).toEqual([]);
      expect(card.reproducibility).toBeNull();
    });

    it('marks a tampered feature receipt as unsealed, independently of the others', () => {
      projectFeature(root, { code: 'mutation-testing', ts: '2026-06-11T00:00:00.000Z' });
      // A second feature whose receipt bytes are tampered: valid JSON + decodable payload
      // (so it still sorts newest by time_verified), but its receipt_hash no longer recomputes.
      const dir = projectFeature(root, { code: 'spec-review', ts: '2026-06-11T01:00:00.000Z' });
      const path = join(root, featureFilePath(dir, 'receipt'));
      const env = JSON.parse(readFileSync(path, 'utf8')) as ReceiptEnvelope;
      env.paqad.receipt_hash = 'f'.repeat(64);
      writeFileSync(path, JSON.stringify(env), 'utf8');

      const feed = buildReceiptFeed(root);
      expect(feed.brokenAt).toBe(0); // the tampered receipt is newest → first card
      expect(feed.receipts[0].sealed).toBe(false); // tampered
      expect(feed.receipts[1].sealed).toBe(true); // the untouched one
    });
  });

  describe('readAiBomDocument', () => {
    it('returns null when no bundle receipt exists', () => {
      expect(readAiBomDocument(root)).toBeNull();
    });

    it('projects the CycloneDX document on demand from the bundle union', () => {
      projectFeature(root, { code: 'mutation-testing' });
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
