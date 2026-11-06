import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildRepositoryVerificationContext } from '@/verification/repository/repository-context.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { DecisionStore } from '@/planning/decision-store.js';
import type { DecisionPacket } from '@/planning/decision-packet.js';
import type { TraceabilityMap } from '@/core/types/traceability.js';
import type { SpecReviewReport } from '@/compliance/types.js';

import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { classifyCompletionEnforcement } from '@/pipeline/session-ownership.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { startStage } from '@/stage-evidence/recorder.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';
import { ImplementationReviewGate } from '@/verification/gates/implementation-review.js';

import { ownInFlightChange } from '../shared.fixture.js';
import { commitAll, git, writeRepoFile } from '../../pipeline/changed-files.fixture.js';
import {
  cleanupOwnChanges,
  IN_TURN,
  OPENED_AT,
  ownChangeRepo,
  TURN,
  writeRuleReport,
} from '../own-change.fixture.js';
import { seedGitChangedFiles } from '../../pipeline/changed-files.fixture.js';

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-repo-ctx-'));
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  return root;
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

const WID = 'D-01J000000000000000000000A1';

function makePacket(): DecisionPacket {
  return {
    decision_id: WID,
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
    seedGitChangedFiles(root, ['src/feature.ts']);
    new DecisionStore(root).writePending(makePacket());

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'ci-backstop',
    });

    expect(context.verification_origin).toBe('ci-backstop');
    expect(context.implementation_review_passed).toBe(false);
    expect(context.implementation_review_findings?.[0]).toMatchObject({
      kind: 'decision-violation',
      decision_id: WID,
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
    seedGitChangedFiles(root, ['src/feature.ts']);
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
    expect(context.spec_review_on_record).toBe(true);
  });

  it('derives a spec boundary and flags an out-of-boundary change as drift', async () => {
    const root = makeProject();
    seedGitChangedFiles(root, ['src/feature/a.ts', 'src/unrelated/x.ts']);
    writeMap(root, frozenAcMap(['src/feature/a.ts']));

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    expect(context.spec_boundary).toContain('src/feature');
    expect(context.spec_boundary).toContain('docs');

    ownInFlightChange(root);
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
    seedGitChangedFiles(root, ['src/feature.ts']);
    const map = frozenAcMap([]);
    map.forward[0].delivering_code = ['bare-file-no-dir'];
    writeMap(root, map);

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'ci-backstop',
    });

    expect(context.spec_boundary).toBeUndefined();
  });

  it('marks spec-review could not prove (without blocking) when code changed but no spec is on record', async () => {
    const root = makeProject();
    seedGitChangedFiles(root, ['src/feature.ts']);

    const { context, escalations } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'ci-backstop',
    });

    expect(context.spec_review_passed).toBe(true);
    expect(context.spec_review_inconclusive).toBe(true);
    expect(context.spec_review_detail).toContain('cannot be proven');
    expect(context.spec_review_on_record).toBeUndefined();
    expect(escalations.join('\n')).not.toContain('spec-review');
  });

  it('names the documentation inputs the backstop never checks, so the docs gate cannot pass on them', async () => {
    const root = makeProject();
    seedGitChangedFiles(root, ['src/feature.ts']);
    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'ci-backstop',
    });
    expect(context.unchecked_documentation_inputs).toEqual([
      'the registries',
      'the glossary',
      'the expected module docs',
    ]);
  });

  it('escalates test-evidence when code changed (backstop cannot collect structured results)', async () => {
    const root = makeProject();
    seedGitChangedFiles(root, ['src/feature.ts']);

    const { context, escalations } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    expect(context.structured_test_results).toBeUndefined();
    expect(escalations.join('\n')).toContain('test-evidence');
  });

  it('does not escalate test-evidence when no code changed', async () => {
    const root = makeProject();
    seedGitChangedFiles(root, ['docs/modules/feature/index/summary.md']);

    const { escalations } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    expect(escalations.join('\n')).not.toContain('test-evidence');
  });

  it('excludes generated .paqad/ artifacts from the changed-file scan', async () => {
    const root = makeProject();
    seedGitChangedFiles(root, [
      'runtime/base/.paqad/audit.log',
      'runtime/base/.paqad/logs/module-health.log',
      'runtime/base/.paqad/module-health-evidence/mh-40ca14cd.json',
      'runtime/base/.paqad/quality-baseline.json',
      '.paqad/session/verification-evidence.json',
    ]);

    const { context, escalations } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    expect(context.changed_files).toEqual([]);
    expect(context.code_changed).toBe(false);
    expect(escalations.join('\n')).not.toContain('test-evidence');

    const verdict = await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations },
    });
    expect(verdict.ok).toBe(true);
  });

  it('keeps real code while dropping .paqad/ artifacts in a mixed change', async () => {
    const root = makeProject();
    seedGitChangedFiles(root, ['src/feature.ts', 'runtime/base/.paqad/audit.log']);

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
    });

    expect(context.changed_files).toEqual(['src/feature.ts']);
    expect(context.code_changed).toBe(true);
  });
});

describe('change_own_files', () => {
  const Y = 'ses_host_y';
  const X = 'ses_cached_x';

  afterEach(cleanupOwnChanges);

  it('AC-35: resolves from the Stop session, not the session in the cache', async () => {
    const { root } = ownChangeRepo(X, 'feat/x');
    git(root, ['switch', '-q', '-c', 'feat/y', 'main']);
    openFeatureChange(root, Y, { adapter: 'claude-code', title: 'y', issue: null });
    writeRepoFile(root, 'y.ts', 'export const y = 1;\n');
    persistLedgerSessionId(root, X);

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
      hostSessionId: Y,
    });

    expect(context.change_own_files).toEqual(['y.ts']);
  });

  it('AC-35: with no Stop session the field stays unset, whatever the cache names', async () => {
    const { root } = ownChangeRepo(X);
    persistLedgerSessionId(root, X);
    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'git-backstop',
    });
    expect(context.change_own_files).toBeUndefined();
  });

  function planningChangeOnOwnBranch(root: string, owner: string): void {
    git(root, ['switch', '-q', '-c', 'feat/other', 'main']);
    const dirName = openFeatureChange(root, owner, {
      adapter: 'claude-code',
      title: 'planning only',
      issue: null,
      now: () => OPENED_AT,
    });
    startStage(root, 'planning', {
      sessionId: owner,
      dirName,
      adapter: 'claude-code',
      now: () => OPENED_AT,
    });
  }

  it('AC-34, AC-35: edits on its own change keep a session judged after it adopts another', () => {
    const { root, dir } = ownChangeRepo(Y, 'feat/own');
    startStage(root, 'development', {
      sessionId: Y,
      dirName: dir,
      adapter: 'claude-code',
      now: () => IN_TURN,
    });
    writeRepoFile(root, 'y.ts', 'export const y = 1;\n');
    commitAll(root, 'feat: y');
    expect(classifyCompletionEnforcement(root, Y)).toMatchObject({
      enforce: true,
      reason: 'edited-this-turn',
    });

    planningChangeOnOwnBranch(root, X);

    expect(classifyCompletionEnforcement(root, Y)).toMatchObject({
      enforce: true,
      reason: 'edited-this-turn',
    });
  });

  it('AC-34, AC-35: earlier work on its own change does not stop the skip on an adopted one', () => {
    const { root } = ownChangeRepo(Y, 'feat/own');
    planningChangeOnOwnBranch(root, X);
    expect(classifyCompletionEnforcement(root, Y)).toMatchObject({
      enforce: false,
      reason: 'empty-change',
    });
  });

  it('AC-34, AC-35: a session with no rows that adopts a planning change stays not-owner', () => {
    const { root } = ownChangeRepo(X, 'feat/own');
    planningChangeOnOwnBranch(root, X);
    writeWorkflowState(root, Y, {
      active: { workflow: 'feature-development' },
      paused: [],
      turn_started_at: TURN,
    });
    expect(classifyCompletionEnforcement(root, Y)).toMatchObject({
      enforce: false,
      reason: 'not-owner',
    });
  });

  describe('INV-5: a change past specification with an empty set is still judged', () => {
    function withDevelopmentRow(): { root: string } {
      const { root, dir } = ownChangeRepo(Y);
      startStage(root, 'development', { sessionId: Y, dirName: dir, adapter: 'claude-code' });
      writeRepoFile(root, 'b.ts', 'export const b = 2;\n');
      return { root };
    }

    async function gateResult(root: string) {
      writeRuleReport(root, 'a.ts');
      const { context } = await buildRepositoryVerificationContext({
        projectRoot: root,
        origin: 'hook-completion',
        hostSessionId: Y,
      });
      expect(context.change_own_files).toEqual([]);
      return new ImplementationReviewGate().check(context);
    }

    it('its edits stashed', async () => {
      const { root } = withDevelopmentRow();
      git(root, ['stash', '-q']);
      expect((await gateResult(root)).outcome).not.toBe('not-required');
    });

    it('its commit reverted', async () => {
      const { root } = withDevelopmentRow();
      commitAll(root, 'feat: b');
      git(root, ['revert', '--no-edit', 'HEAD']);
      expect((await gateResult(root)).outcome).not.toBe('not-required');
    });

    it('a change with planning rows only still reads not required', async () => {
      const { root } = ownChangeRepo(Y);
      const result = await gateResult(root);
      expect(result.outcome).toBe('not-required');
      expect(result.detail).toBe('no files changed in this change yet');
    });
  });

  it('AC-20: a resumed session keeps its own dirty-baseline file and its finding fails', async () => {
    const { root } = ownChangeRepo(Y);
    writeRepoFile(root, 'a.ts', 'export const a = 2;\n');
    const dirty = createHash('sha256')
      .update(readFileSync(join(root, 'a.ts')))
      .digest('hex');
    writeFileSync(
      join(root, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, Y), '.dirty-baseline.json'),
      JSON.stringify({ files: { 'a.ts': dirty } }),
    );
    writeRuleReport(root, 'a.ts');

    const { context } = await buildRepositoryVerificationContext({
      projectRoot: root,
      origin: 'hook-completion',
      hostSessionId: Y,
    });
    expect(context.changed_files).not.toContain('a.ts');
    expect(context.change_own_files).toEqual(['a.ts']);

    const result = await new ImplementationReviewGate().check(context);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('a.ts:3');
  });
});
