import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { syncFrameworkConfig } from '@/core/framework-config.js';
import type { VerificationContext } from '@/core/types/verification.js';
import { readFeatureEvidence } from '@/feature-evidence/bundle-ledgers.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { createVerificationContext, ownInFlightChange } from '../shared.fixture.js';

const SES = 'ses-seal-recheck-669';

describe('a failed receipt seal still fails bundle completeness', () => {
  let context: VerificationContext;
  let dir: string;

  beforeEach(() => {
    context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      changed_files: ['src/feature.ts'],
      changed_files_source: 'git',
    });
    const root = context.project_root;
    const sessionId = resolveSessionId(root, SES);
    dir = openFeatureChange(root, sessionId, {
      adapter: 'claude-code',
      title: 'seal',
      issue: '669',
    });
    ownInFlightChange(root, sessionId, dir);
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'project-profile.yaml'),
      'project:\n  name: demo\nactive_capabilities:\n  - content\n',
    );
    syncFrameworkConfig(root, {
      enterprise: {
        enabled: true,
        evidence_ledger: true,
        ai_bom: false,
        compliance_citations: false,
      },
    });
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'feature-development', lane: 'full' },
      paused: [],
      turn_started_at: '2000-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    rmSync(context.project_root, { recursive: true, force: true });
  });

  async function verify() {
    return runRepositoryVerification({
      origin: 'hook-completion',
      projectRoot: context.project_root,
      hostSessionId: SES,
      prebuiltContext: { context, escalations: [] },
    });
  }

  function lastCompletenessRow() {
    return readFeatureEvidence(context.project_root, dir)
      .filter((row) => row.code === 'bundle-completeness')
      .at(-1);
  }

  it('does not name receipt.json when the seal is written', async () => {
    await verify();

    const gate = lastCompletenessRow();
    expect(gate?.detail).not.toContain('receipt.json');
  });

  it('fails the strict gate by naming receipt.json when the seal cannot be written', async () => {
    const receiptPath = join(context.project_root, featureFilePath(dir, 'receipt'));
    mkdirSync(receiptPath, { recursive: true });
    writeFileSync(join(receiptPath, 'blocker'), 'x');

    const verdict = await verify();

    expect(verdict.ok).toBe(false);
    const gate = verdict.gates.find((g) => g.gate === 'bundle-completeness');
    expect(gate?.status).toBe('fail');
    expect(gate?.detail).toContain('receipt.json');
    const row = lastCompletenessRow();
    expect(row?.verdict).toBe('fail');
    expect(row?.detail).toContain('receipt.json');
  });

  it('under warn, names the missing receipt without blocking on it', async () => {
    mkdirSync(join(context.project_root, '.paqad', 'configs'), { recursive: true });
    writeFileSync(
      join(context.project_root, '.paqad', 'configs', '.config.app'),
      'bundle_completeness=warn\n',
    );
    const receiptPath = join(context.project_root, featureFilePath(dir, 'receipt'));
    mkdirSync(receiptPath, { recursive: true });
    writeFileSync(join(receiptPath, 'blocker'), 'x');

    const verdict = await verify();

    const gate = verdict.gates.find((g) => g.gate === 'bundle-completeness');
    expect(gate?.status).toBe('inconclusive');
    expect(gate?.detail).toContain('receipt.json');
  });
});
