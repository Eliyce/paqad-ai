import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { syncFrameworkConfig } from '@/core/framework-config.js';
import type { EnterpriseConfig } from '@/core/types/project-profile.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { readEvidenceLedger } from '@/evidence/ledger.js';
import { decodeReceiptStatement, readReceiptChain } from '@/evidence/receipt/project.js';
import { verifyReceiptChain } from '@/evidence/receipt/dsse.js';
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

describe('runRepositoryVerification — evidence ledger + receipt (issue #118)', () => {
  it('fans gate results into the ledger and projects a verifiable receipt', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    // Issue #187 — the ledger is opt-in; enable it for this assertion.
    enableEnterprise(context.project_root, { evidence_ledger: true, ai_bom: true });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
    });

    const rows = readEvidenceLedger(context.project_root);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.engine === 'verification-gate')).toBe(true);
    // Every emitted row is graded — no flat booleans.
    expect(
      rows.every((r) => ['deterministic', 'llm-judged', 'blocked'].includes(r.strength_class)),
    ).toBe(true);

    expect(existsSync(join(context.project_root, PATHS.EVIDENCE_RECEIPT))).toBe(true);
    const receipt = JSON.parse(
      readFileSync(join(context.project_root, PATHS.EVIDENCE_RECEIPT), 'utf8'),
    );
    expect(receipt.payloadType).toBe('application/vnd.in-toto+json');

    const chain = readReceiptChain(context.project_root);
    expect(verifyReceiptChain(chain)).toBeNull();

    // Issue #120 — authorship is wired in: when the resolver yields anything
    // (env/git-dependent in this fixture), it is well-formed and inside the
    // signed payload, not bolted on afterwards.
    const statement = decodeReceiptStatement(chain[chain.length - 1]);
    const authorship = statement?.predicate.change_authorship;
    if (authorship !== undefined) {
      expect(['declared', 'unknown']).toContain(authorship.provenance);
    }
  });

  it('projects the per-feature receipt + ai-bom into the active feature bundle (#343 B)', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    // An active feature under a known session (the verification path resolves the same id).
    const SES = 'rv-feature-sess';
    const sessionId = resolveSessionId(context.project_root, SES);
    const dir = openFeatureChange(context.project_root, sessionId, {
      adapter: 'claude-code',
      title: 'Feature',
      issue: null,
    });
    enableEnterprise(context.project_root, { evidence_ledger: true, ai_bom: true });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
    });

    // The whole-project receipt still lands...
    expect(existsSync(join(context.project_root, PATHS.EVIDENCE_RECEIPT))).toBe(true);
    // ...AND the same graded rows are projected into the feature's own bundle.
    expect(existsSync(join(context.project_root, featureFilePath(dir, 'receipt')))).toBe(true);
    expect(existsSync(join(context.project_root, featureFilePath(dir, 'aiBom')))).toBe(true);
  });

  it('per-feature honours the enterprise gating: ai_bom-only writes only the bundle ai-bom.json (#343 B)', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const SES = 'rv-feature-aibom';
    const sessionId = resolveSessionId(context.project_root, SES);
    const dir = openFeatureChange(context.project_root, sessionId, {
      adapter: 'claude-code',
      title: 'Feature',
      issue: null,
    });
    enableEnterprise(context.project_root, { enabled: true, evidence_ledger: false, ai_bom: true });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
    });

    expect(existsSync(join(context.project_root, featureFilePath(dir, 'aiBom')))).toBe(true);
    expect(existsSync(join(context.project_root, featureFilePath(dir, 'receipt')))).toBe(false);
  });

  // Issue #390 — receipt/ai-bom/report render must consult the persisted route, not
  // just "is a pointer active?", so a non-feature workflow projects nothing.
  it('projects NO receipt/ai-bom/report for a non-feature route even with an active pointer', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const SES = 'rv-nonfeature-route';
    const sessionId = resolveSessionId(context.project_root, SES);
    const dir = openFeatureChange(context.project_root, sessionId, {
      adapter: 'claude-code',
      title: 'Feature',
      issue: null,
    });
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
      hostSessionId: SES,
    });

    expect(existsSync(join(context.project_root, featureFilePath(dir, 'receipt')))).toBe(false);
    expect(existsSync(join(context.project_root, featureFilePath(dir, 'aiBom')))).toBe(false);
    expect(existsSync(join(context.project_root, featureReportPath(dir)))).toBe(false);
  });

  it('renders the feature report for a feature-development route', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    const SES = 'rv-feature-route';
    const sessionId = resolveSessionId(context.project_root, SES);
    const dir = openFeatureChange(context.project_root, sessionId, {
      adapter: 'claude-code',
      title: 'Feature',
      issue: null,
    });
    writeWorkflowState(context.project_root, sessionId, {
      active: { workflow: 'feature-development' },
      paused: [],
    });

    await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: SES,
    });

    expect(existsSync(join(context.project_root, featureReportPath(dir)))).toBe(true);
  });

  it('never blocks verification when no files changed (empty subject still receipts)', async () => {
    const context = createVerificationContext({ changed_files: [] });
    enableEnterprise(context.project_root, { evidence_ledger: true });
    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
    });
    expect(verdict).toBeDefined();
    expect(existsSync(join(context.project_root, PATHS.EVIDENCE_RECEIPT))).toBe(true);
  });
});

describe('runRepositoryVerification — enterprise ledger gating (issue #187)', () => {
  function run(context: ReturnType<typeof createVerificationContext>) {
    return runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
    });
  }

  function ledgerExists(projectRoot: string) {
    return {
      evidence: existsSync(join(projectRoot, PATHS.EVIDENCE_LEDGER)),
      receipt: existsSync(join(projectRoot, PATHS.EVIDENCE_RECEIPT)),
      chain: existsSync(join(projectRoot, PATHS.EVIDENCE_RECEIPT_CHAIN)),
      aiBom: existsSync(join(projectRoot, PATHS.EVIDENCE_AI_BOM)),
    };
  }

  it('writes nothing under .paqad/ledger/ when no enterprise block is present', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });

    const verdict = await run(context);

    // The verdict is still produced — gating never changes the trust outcome.
    expect(verdict).toBeDefined();
    const files = ledgerExists(context.project_root);
    expect(files.evidence).toBe(false);
    expect(files.receipt).toBe(false);
    expect(files.chain).toBe(false);
    expect(files.aiBom).toBe(false);
  });

  it('master switch off forces every sub-flag off (no writes)', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    enableEnterprise(context.project_root, {
      enabled: false,
      evidence_ledger: true,
      ai_bom: true,
      compliance_citations: true,
    });

    await run(context);

    const files = ledgerExists(context.project_root);
    expect(files.evidence).toBe(false);
    expect(files.receipt).toBe(false);
    expect(files.aiBom).toBe(false);
  });

  it('ai_bom on with evidence_ledger off writes only ai-bom.json', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    enableEnterprise(context.project_root, {
      enabled: true,
      evidence_ledger: false,
      ai_bom: true,
    });

    await run(context);

    const files = ledgerExists(context.project_root);
    expect(files.aiBom).toBe(true);
    expect(files.evidence).toBe(false);
    expect(files.receipt).toBe(false);
    expect(files.chain).toBe(false);
  });

  it('compliance_citations off omits the citations field from the receipt', async () => {
    const context = createVerificationContext({
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });
    enableEnterprise(context.project_root, {
      enabled: true,
      evidence_ledger: true,
      compliance_citations: false,
    });

    await run(context);

    const chain = readReceiptChain(context.project_root);
    const statement = decodeReceiptStatement(chain[chain.length - 1]);
    expect(statement?.predicate.compliance_citations).toBeUndefined();
  });
});
