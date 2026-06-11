import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildEvidenceComment,
  readVerificationEvidence,
  renderAuthorshipLine,
  renderEvidenceMarkdown,
} from '@/verification/evidence-markdown';
import { projectReceipt } from '@/evidence/receipt/project';
import { buildEvidenceRow } from '@/evidence/ledger';
import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from '@/verification/evidence';
import type {
  VerificationEvidence,
  VerificationEvidenceGate,
} from '@/core/types/verification-evidence';

function gate(
  partial: Partial<VerificationEvidenceGate> & Pick<VerificationEvidenceGate, 'name' | 'status'>,
): VerificationEvidenceGate {
  return {
    detail: 'ok',
    remediation: null,
    failures: [],
    ...partial,
  };
}

const PASSING: VerificationEvidence = {
  schema_version: '1.1.0',
  run_id: 'run-1',
  started_at: '2026-06-01T00:00:00.000Z',
  completed_at: '2026-06-01T00:01:00.000Z',
  overall_status: 'pass',
  first_failure_gate: null,
  gates: [
    gate({
      name: 'code-tests-lint',
      status: 'pass',
      detail: 'Structured test results show 247/247 passing checks',
    }),
    gate({
      name: 'mutation-testing',
      status: 'pass',
      detail:
        'Every behaviour-changing mutant was killed (kill rate 87%; killed 40, survived 0, set-aside 2).',
      confidence: 'mature',
    }),
    gate({ name: 'quality-ratchet', status: 'pass', detail: 'No measure regressed.' }),
    gate({ name: 'spec-review', status: 'skipped', detail: 'Gate did not run.' }),
  ],
};

describe('renderEvidenceMarkdown', () => {
  it('renders a green "Safe to merge" headline for a passing run', () => {
    const md = renderEvidenceMarkdown(PASSING);
    expect(md).toMatch(/^## paqad evidence {2}🟢 Safe to merge$/m);
    expect(md).toMatch(/Attests paqad’s gates passed/);
  });

  it('shows a 7-char sha label when provided', () => {
    const md = renderEvidenceMarkdown(PASSING, { sha: '0123456789abcdef0123456789abcdef01234567' });
    expect(md).toMatch(/## paqad evidence — 0123456 {2}🟢/);
  });

  it('surfaces the trust gates verbatim, including kill rate and pass counts', () => {
    const md = renderEvidenceMarkdown(PASSING);
    expect(md).toMatch(/🟢 Tests — Structured test results show 247\/247 passing checks/);
    expect(md).toMatch(/🟢 Mutation — Every behaviour-changing mutant was killed \(kill rate 87%/);
    expect(md).toMatch(/🟢 Quality ratchet — No measure regressed\./);
  });

  it('rolls up gate counts', () => {
    expect(renderEvidenceMarkdown(PASSING)).toMatch(
      /Gates: 3 passed, 0 failed, 0 inconclusive, 1 skipped\./,
    );
  });

  it('flags lower-confidence mutation results and never hides them', () => {
    const md = renderEvidenceMarkdown({
      ...PASSING,
      gates: [
        gate({
          name: 'mutation-testing',
          status: 'pass',
          detail: 'kill rate 90%',
          confidence: 'lower',
        }),
      ],
    });
    expect(md).toMatch(/confidence: lower — do not over-trust/);
  });

  it('renders a red headline and pins failures to file:line', () => {
    const failing: VerificationEvidence = {
      ...PASSING,
      overall_status: 'fail',
      first_failure_gate: 'code-tests-lint',
      gates: [
        gate({
          name: 'code-tests-lint',
          status: 'fail',
          detail: '2 checks failing',
          remediation: 'Fix the failing assertions.',
          failures: [
            {
              category: 'test-failure',
              file: 'src/foo.ts',
              line: 42,
              test_id: 'foo-1',
              suite: 'foo',
              ac_id: null,
              message: 'expected 1 to be 2',
              stderr_excerpt: null,
            },
          ],
        }),
      ],
    };
    const md = renderEvidenceMarkdown(failing);
    expect(md).toMatch(/🔴 Needs your attention/);
    expect(md).toMatch(/### Blocking/);
    expect(md).toMatch(/- src\/foo\.ts:42 — expected 1 to be 2/);
    expect(md).toMatch(/_Fix:_ Fix the failing assertions\./);
  });

  it('falls back gracefully when a failure has no file:line', () => {
    const md = renderEvidenceMarkdown({
      ...PASSING,
      overall_status: 'fail',
      gates: [
        gate({
          name: 'mutation-testing',
          status: 'fail',
          detail: 'survivor',
          failures: [
            {
              category: 'gate-failure',
              file: null,
              line: null,
              test_id: null,
              suite: null,
              ac_id: null,
              message: 'a surviving mutant',
              stderr_excerpt: null,
            },
          ],
        }),
      ],
    });
    expect(md).toMatch(/ {2}- a surviving mutant$/m);
  });

  it('is deterministic — identical evidence yields byte-identical output', () => {
    expect(renderEvidenceMarkdown(PASSING)).toBe(renderEvidenceMarkdown(PASSING));
  });

  it('appends the authorship footer when authorship is supplied', () => {
    const md = renderEvidenceMarkdown(PASSING, {
      authorship: {
        agent: 'cursor',
        model: 'gpt-5',
        provider: 'openai',
        model_id: 'openai/gpt-5',
        accepting_human: { name: 'Jane Dev', email: 'jane@example.com' },
        provenance: 'declared',
      },
    });
    expect(md).toContain(
      '> Authorship: written by `cursor` · model `openai/gpt-5` (declared) · accepted by Jane Dev.',
    );
    // The accepter email stays out of the public comment.
    expect(md).not.toContain('jane@example.com');
  });

  it('omits the footer when no authorship is supplied', () => {
    expect(renderEvidenceMarkdown(PASSING)).not.toContain('Authorship:');
  });
});

describe('renderAuthorshipLine', () => {
  it('returns null when no renderable field is present', () => {
    expect(renderAuthorshipLine({ provenance: 'unknown' })).toBeNull();
  });

  it('drops the (declared) qualifier when provenance is unknown', () => {
    const line = renderAuthorshipLine({ agent: 'aider', provenance: 'unknown' });
    expect(line).toBe(
      '> Authorship: written by `aider`. paqad attests this on its gates, so the proof holds whichever tool wrote it.',
    );
  });
});

describe('readVerificationEvidence', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-evidence-read-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when the evidence file is absent', () => {
    expect(readVerificationEvidence(root)).toBeNull();
  });

  it('returns null when the evidence file is unparseable', () => {
    const path = join(root, VERIFICATION_EVIDENCE_RELATIVE_PATH);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, '{ not json', 'utf8');
    expect(readVerificationEvidence(root)).toBeNull();
  });

  it('round-trips a persisted evidence object', () => {
    const path = join(root, VERIFICATION_EVIDENCE_RELATIVE_PATH);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(PASSING), 'utf8');
    expect(readVerificationEvidence(root)).toEqual(PASSING);
  });
});

describe('buildEvidenceComment', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-evidence-comment-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when no evidence exists (self-disables auto-post)', () => {
    expect(buildEvidenceComment(root)).toBeNull();
  });

  it('renders the comment body, passing the sha through', () => {
    const path = join(root, VERIFICATION_EVIDENCE_RELATIVE_PATH);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(PASSING), 'utf8');
    const body = buildEvidenceComment(root, 'deadbeefcafe');
    expect(body).toMatch(/## paqad evidence — deadbee {2}🟢 Safe to merge/);
  });

  it('folds in authorship from the latest receipt', async () => {
    const path = join(root, VERIFICATION_EVIDENCE_RELATIVE_PATH);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(PASSING), 'utf8');

    await projectReceipt({
      projectRoot: root,
      fileDigests: [{ name: 'src/a.ts', sha256: 'aaa' }],
      rows: [
        buildEvidenceRow({
          ts: '2026-06-11T00:00:00.000Z',
          engine: 'verification-gate',
          code: 'mutation-testing',
          subject_digest: 'subject-1',
          verdict: 'pass',
          strength_class: 'deterministic',
        }),
      ],
      verifierVersion: '1.0.0',
      timeVerified: '2026-06-11T00:00:00.000Z',
      authorship: {
        agent: 'claude-code',
        model_id: 'anthropic/claude-opus-4-8',
        provenance: 'declared',
      },
    });

    const body = buildEvidenceComment(root);
    expect(body).toContain('written by `claude-code`');
    expect(body).toContain('model `anthropic/claude-opus-4-8` (declared)');
  });
});
