import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { syncFrameworkConfig } from '@/core/framework-config.js';
import type { EnterpriseConfig } from '@/core/types/project-profile.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { decodeReceiptStatement } from '@/evidence/receipt/project.js';
import { verifyReceiptSeal } from '@/evidence/receipt/dsse.js';
import { readFeatureEvidence } from '@/feature-evidence/bundle-ledgers.js';
import { readFeatureReceipt } from '@/feature-evidence/receipt.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { featureFilePath, featureReportPath } from '@/feature-evidence/paths.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';

import { createVerificationContext } from '../verification/shared.fixture.js';

/**
 * Issue #187/#220 — the enterprise block moved out of `project-profile.yaml` into
 * `.paqad/.config` (flat KEY=VALUE), so opt the ledger on by syncing the
 * `enterprise` section into `.config`. A lean `project-profile.yaml` (project
 * facts only) must still exist so `readProjectProfile` returns a profile for the
 * `.config` overlay to apply onto. Defaults turn on the full ledger write set
 * (enabled + evidence_ledger + ai_bom); pass overrides to exercise sub-flags.
 */
function enableEnterprise(projectRoot: string, enterprise: Partial<EnterpriseConfig> = {}): void {
  const block: EnterpriseConfig = {
    enabled: true,
    evidence_ledger: true,
    ai_bom: true,
    compliance_citations: false,
    ...enterprise,
  };
  mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.paqad', 'project-profile.yaml'),
    'project:\n  name: demo\nactive_capabilities:\n  - content\n',
  );
  syncFrameworkConfig(projectRoot, { enterprise: block });
}

/**
 * Issue #468 Phase C — the completion seam no longer writes the top-level
 * `.paqad/ledger/{evidence.jsonl,receipts.jsonl,receipt.dsse.json,ai-bom.json}`; the
 * per-feature bundle is the only projection. This is the INV-5 regression guard every
 * test asserts: none of the retired top-level homes exists after a run.
 */
function noTopLevelLedger(projectRoot: string): void {
  expect(existsSync(join(projectRoot, PATHS.EVIDENCE_LEDGER))).toBe(false);
  expect(existsSync(join(projectRoot, PATHS.EVIDENCE_RECEIPT))).toBe(false);
  expect(existsSync(join(projectRoot, PATHS.EVIDENCE_RECEIPT_CHAIN))).toBe(false);
  expect(existsSync(join(projectRoot, PATHS.EVIDENCE_AI_BOM))).toBe(false);
}

/** Open an active feature bundle under a known session (the seam resolves the same id). */
function openFeature(projectRoot: string, ses: string): { sessionId: string; dir: string } {
  const sessionId = resolveSessionId(projectRoot, ses);
  const dir = openFeatureChange(projectRoot, sessionId, {
    adapter: 'claude-code',
    title: 'Feature',
    issue: null,
  });
  return { sessionId, dir };
}

describe('runRepositoryVerification — per-feature bundle evidence + receipt (issue #118/#343/#468)', () => {
  it('fans gate results into the bundle evidence.jsonl + a verifiable bundle receipt, writing NO top-level ledger', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const { dir } = openFeature(context.project_root, 'rv-evidence-sess');
    // Issue #187 — the ledger is opt-in; enable it for this assertion.
    enableEnterprise(context.project_root, { evidence_ledger: true, ai_bom: true });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: 'rv-evidence-sess',
    });

    // Issue #468 Phase C — the graded rows live in the feature's own bundle now.
    const rows = readFeatureEvidence(context.project_root, dir);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.engine === 'verification-gate')).toBe(true);
    // Every emitted row is graded — no flat booleans.
    expect(
      rows.every((r) => ['deterministic', 'llm-judged', 'blocked'].includes(r.strength_class)),
    ).toBe(true);

    // The bundle receipt is the projection, and it verifies as a single sealed snapshot.
    const envelope = readFeatureReceipt(context.project_root, dir);
    expect(envelope).not.toBeNull();
    expect(envelope!.payloadType).toBe('application/vnd.in-toto+json');
    expect(verifyReceiptSeal(envelope!)).toBe(true);

    // Issue #120 — authorship is wired in: when the resolver yields anything
    // (env/git-dependent in this fixture), it is well-formed and inside the signed payload.
    const authorship = decodeReceiptStatement(envelope!)?.predicate.change_authorship;
    if (authorship !== undefined) {
      expect(['declared', 'unknown']).toContain(authorship.provenance);
    }

    // Issue #468 Phase C / INV-5 — the retired top-level homes are never written.
    noTopLevelLedger(context.project_root);
  });

  it('projects the per-feature receipt + ai-bom into the active feature bundle (#343 B)', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const { dir } = openFeature(context.project_root, 'rv-feature-sess');
    enableEnterprise(context.project_root, { evidence_ledger: true, ai_bom: true });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: 'rv-feature-sess',
    });

    // The graded rows are projected into the feature's own bundle — and only there.
    expect(existsSync(join(context.project_root, featureFilePath(dir, 'receipt')))).toBe(true);
    expect(existsSync(join(context.project_root, featureFilePath(dir, 'aiBom')))).toBe(true);
    noTopLevelLedger(context.project_root);
  });

  it('per-feature honours the enterprise gating: ai_bom-only writes only the bundle ai-bom.json (#343 B)', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const { dir } = openFeature(context.project_root, 'rv-feature-aibom');
    enableEnterprise(context.project_root, { enabled: true, evidence_ledger: false, ai_bom: true });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: 'rv-feature-aibom',
    });

    expect(existsSync(join(context.project_root, featureFilePath(dir, 'aiBom')))).toBe(true);
    expect(existsSync(join(context.project_root, featureFilePath(dir, 'receipt')))).toBe(false);
    noTopLevelLedger(context.project_root);
  });

  // Issue #390 — receipt/ai-bom/report render must consult the persisted route, not
  // just "is a pointer active?", so a non-feature workflow projects nothing.
  it('projects NO receipt/ai-bom/report for a non-feature route even with an active pointer', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const { sessionId, dir } = openFeature(context.project_root, 'rv-nonfeature-route');
    // The session's route is a non-feature workflow.
    writeWorkflowState(context.project_root, sessionId, {
      active: { workflow: 'root-cause-analysis' },
      paused: [],
    });
    enableEnterprise(context.project_root, { evidence_ledger: true, ai_bom: true });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: 'rv-nonfeature-route',
    });

    expect(existsSync(join(context.project_root, featureFilePath(dir, 'receipt')))).toBe(false);
    expect(existsSync(join(context.project_root, featureFilePath(dir, 'aiBom')))).toBe(false);
    expect(existsSync(join(context.project_root, featureReportPath(dir)))).toBe(false);
    noTopLevelLedger(context.project_root);
  });

  it('renders the feature report for a feature-development route', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const { sessionId, dir } = openFeature(context.project_root, 'rv-feature-route');
    writeWorkflowState(context.project_root, sessionId, {
      active: { workflow: 'feature-development' },
      paused: [],
    });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: 'rv-feature-route',
    });

    expect(existsSync(join(context.project_root, featureReportPath(dir)))).toBe(true);
  });

  it('never blocks verification when no files changed, and writes no top-level ledger', async () => {
    const context = createVerificationContext({ changed_files: [] });
    enableEnterprise(context.project_root, { evidence_ledger: true });
    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
    });
    expect(verdict).toBeDefined();
    // No active feature + retired top-level home ⇒ nothing is written anywhere.
    noTopLevelLedger(context.project_root);
  });
});

describe('runRepositoryVerification — enterprise bundle gating (issue #187/#468)', () => {
  function run(context: ReturnType<typeof createVerificationContext>, ses: string) {
    return runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: ses,
    });
  }

  /** Which of the feature bundle's graded artifacts exist after a run. */
  function bundleFiles(projectRoot: string, dir: string) {
    return {
      evidence: existsSync(join(projectRoot, featureFilePath(dir, 'evidence'))),
      receipt: existsSync(join(projectRoot, featureFilePath(dir, 'receipt'))),
      aiBom: existsSync(join(projectRoot, featureFilePath(dir, 'aiBom'))),
    };
  }

  it('writes nothing to the bundle when no enterprise block is present', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const { dir } = openFeature(context.project_root, 'rv-ent-none');

    const verdict = await run(context, 'rv-ent-none');

    // The verdict is still produced — gating never changes the trust outcome.
    expect(verdict).toBeDefined();
    expect(bundleFiles(context.project_root, dir)).toEqual({
      evidence: false,
      receipt: false,
      aiBom: false,
    });
    noTopLevelLedger(context.project_root);
  });

  it('master switch off forces every sub-flag off (no writes)', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const { dir } = openFeature(context.project_root, 'rv-ent-off');
    enableEnterprise(context.project_root, {
      enabled: false,
      evidence_ledger: true,
      ai_bom: true,
      compliance_citations: true,
    });

    await run(context, 'rv-ent-off');

    expect(bundleFiles(context.project_root, dir)).toEqual({
      evidence: false,
      receipt: false,
      aiBom: false,
    });
    noTopLevelLedger(context.project_root);
  });

  it('ai_bom on with evidence_ledger off writes only the bundle ai-bom.json', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const { dir } = openFeature(context.project_root, 'rv-ent-aibom');
    enableEnterprise(context.project_root, {
      enabled: true,
      evidence_ledger: false,
      ai_bom: true,
    });

    await run(context, 'rv-ent-aibom');

    expect(bundleFiles(context.project_root, dir)).toEqual({
      evidence: false,
      receipt: false,
      aiBom: true,
    });
    noTopLevelLedger(context.project_root);
  });

  it('compliance_citations off omits the citations field from the bundle receipt', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const { dir } = openFeature(context.project_root, 'rv-ent-cite');
    enableEnterprise(context.project_root, {
      enabled: true,
      evidence_ledger: true,
      compliance_citations: false,
    });

    await run(context, 'rv-ent-cite');

    const envelope = readFeatureReceipt(context.project_root, dir);
    expect(envelope).not.toBeNull();
    const statement = decodeReceiptStatement(envelope!);
    expect(statement?.predicate.compliance_citations).toBeUndefined();
  });
});
