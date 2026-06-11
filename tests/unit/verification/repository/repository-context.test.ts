import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildRepositoryVerificationContext } from '@/verification/repository/repository-context.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { DecisionStore } from '@/planning/decision-store.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import type { TraceabilityMap } from '@/core/types/traceability.js';
import type { SpecReviewReport } from '@/compliance/types.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-repo-ctx-'));
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  return root;
}

function setChangedFiles(root: string, files: string[]): void {
  writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify(files));
}

function writeSpecReview(root: string, slug: string, report: SpecReviewReport): void {
  mkdirSync(join(root, `.paqad/compliance/${slug}`), { recursive: true });
  writeFileSync(join(root, `.paqad/compliance/${slug}/spec-review.json`), JSON.stringify(report));
}

function frozenAcMap(deliveringCode: string[]): TraceabilityMap {
  return {
    schema_version: '1.0.0',
    generated_at: '2026-01-01T00:00:00.000Z',
    lane: 'full',
    mode: 'full',
    anchors_known: true,
    blocked_reason: null,
    forward: [
      {
        promise_id: 'AC-1',
        source: 'acceptance-criterion',
        description: 'works',
        delivering_code: deliveringCode,
        proving_checks: ['tests/feature.test.ts'],
        proven: true,
      },
    ],
    backward: [],
    findings: [],
    counts: {
      promises: 1,
      untested_promises: 0,
      delivers_promise: 1,
      shared_groundwork: 0,
      orphan_code: 0,
    },
  };
}

function writeMap(root: string, map: TraceabilityMap): void {
  mkdirSync(join(root, '.paqad/traceability'), { recursive: true });
  writeFileSync(join(root, '.paqad/traceability/map.json'), JSON.stringify(map));
}

function makePacket(): DecisionPacket {
  return {
    decision_id: 'D-1',
    fingerprint: 'sha256:test',
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
    requested_by: 'codex-cli',
    task_session_id: 'session-1',
    created_at: '2026-04-27T12:00:00Z',
    status: 'pending',
    ttl_until: '2099-12-31T12:00:00Z',
    invalidation_watch: [],
  } as DecisionPacket;
}

describe('buildRepositoryVerificationContext', () => {
  it('computes a blocking implementation-review finding from an unresolved decision', async () => {
    const root = makeProject();
    setChangedFiles(root, ['src/feature.ts']);
    new DecisionStore(root).writePending(makePacket());

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'ci-backstop',
    });

    expect(context.verification_origin).toBe('ci-backstop');
    expect(context.implementation_review_passed).toBe(false);
    expect(context.implementation_review_findings?.[0]).toMatchObject({
      kind: 'decision-violation',
      decision_id: 'D-1',
    });

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'ci-backstop',
      prebuiltContext: { context, escalations: [] },
    });
    expect(verdict.ok).toBe(false);
  });

  it('fails spec-review on an unresolved critical defect discovered by glob', async () => {
    const root = makeProject();
    setChangedFiles(root, ['src/feature.ts']);
    writeSpecReview(root, 'feature-spec', {
      metadata: { spec_hash: 'h', test_files_hash: 't' },
      defects: [{ defect_id: 'SR-9', severity: 'critical', status: 'new' }],
      pattern_advisories: [],
    } as unknown as SpecReviewReport);

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'git-backstop',
    });

    expect(context.spec_review_passed).toBe(false);
  });

  it('derives a spec boundary and flags an out-of-boundary change as drift', async () => {
    const root = makeProject();
    setChangedFiles(root, ['src/feature/a.ts', 'src/unrelated/x.ts']);
    writeMap(root, frozenAcMap(['src/feature/a.ts']));

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    expect(context.spec_boundary).toContain('src/feature');
    expect(context.spec_boundary).toContain('docs');

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('src/unrelated/x.ts');
  });

  it('leaves the spec boundary undefined when a frozen spec delivers no directories', async () => {
    const root = makeProject();
    setChangedFiles(root, ['src/feature.ts']);
    // Frozen AC present (so hasFrozenSpec) but no delivering directories.
    const map = frozenAcMap([]);
    map.forward[0].delivering_code = ['bare-file-no-dir'];
    writeMap(root, map);

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'ci-backstop',
    });

    expect(context.spec_boundary).toBeUndefined();
  });

  it('escalates (without blocking) when code changed but no spec is on record', async () => {
    const root = makeProject();
    setChangedFiles(root, ['src/feature.ts']);

    const { context, escalations } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'ci-backstop',
    });

    expect(context.spec_review_passed).toBe(true);
    expect(escalations.join('\n')).toContain('spec-review');
  });
});
