import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { readEvidenceLedger } from '@/evidence/ledger.js';
import { readReceiptChain } from '@/evidence/receipt/project.js';
import { verifyReceiptChain } from '@/evidence/receipt/dsse.js';

import { createVerificationContext } from '../verification/shared.fixture.js';

describe('runRepositoryVerification — evidence ledger + receipt (issue #118)', () => {
  it('fans gate results into the ledger and projects a verifiable receipt', async () => {
    const context = createVerificationContext({
      verification_origin: 'hook-completion',
      verification_stage: 'backstop-completion',
      changed_files: ['docs/modules/core/ui/screens.md'],
      changed_files_source: 'git-status',
    });

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
  });

  it('never blocks verification when no files changed (empty subject still receipts)', async () => {
    const context = createVerificationContext({ changed_files: [] });
    const verdict = await runRepositoryVerification({
      projectRoot: context.project_root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
    });
    expect(verdict).toBeDefined();
    expect(existsSync(join(context.project_root, PATHS.EVIDENCE_RECEIPT))).toBe(true);
  });
});
