import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { renderDelivery } from '@/delivery/templates.js';
import { defaultGitWorkflow, renderDefaultGitWorkflowFile } from '@/git-workflow/defaults.js';
import { designSignOffPrLine, designSignOffReceiptLine } from '@/hld/report.js';
import { emptyHldRecord, writeHld } from '@/hld/store.js';
import { composeChangeReceipt } from '@/verification/repository/receipt.js';

const DIR = 'add-checkout-01M6QK5T2B678P4DRW3T7FPYQB';
const REF = ['PQD', '123'].join('-');
const LINK = 'https://acme.atlassian.net/browse/x?focusedCommentId=1';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-hld-report-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function enable(): void {
  mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
  writeFileSync(
    join(root, PATHS.GIT_WORKFLOW_DIR, 'design-sign-off.yaml'),
    renderDefaultGitWorkflowFile('design-sign-off.yaml').replace('enabled: false', 'enabled: true'),
  );
}

const body = (line: string) =>
  renderDelivery(
    defaultGitWorkflow(),
    { ticket: REF, title: 't', summary: 's', design_sign_off: line },
    '## Summary\n{summary}\n',
  ).pr_body;

describe('design sign-off in the PR body and receipt', () => {
  it('AC-53: an approved design puts the signed-off line in the PR body and the receipt', () => {
    enable();
    writeHld(root, DIR, {
      ...emptyHldRecord(REF),
      state: 'approved',
      approved_at: '2026-10-31T08:00:00Z',
      approval_link: LINK,
    });
    const line = designSignOffPrLine(root, DIR);
    expect(line).toBe(`High-level design signed off in ${REF} on 31 Oct (${LINK}).`);
    expect(body(line)).toBe(`## Summary\ns\n\n${line}\n`);
    expect(designSignOffReceiptLine(root, DIR, 'full')).toBe(
      `🟢 High-level design signed off (${LINK})`,
    );
  });

  it('AC-53: a posted design shows posted, not signed off; off shows off for this team', () => {
    enable();
    writeHld(root, DIR, { ...emptyHldRecord(REF), state: 'awaiting_sign_off' });
    expect(designSignOffReceiptLine(root, DIR, 'full')).toContain('🟡 posted, not signed off');
    expect(designSignOffReceiptLine(root, DIR, 'fast')).toContain('⚪ off for this team');
    expect(designSignOffPrLine(root, DIR)).toBe('');
  });

  it('AC-47: a skip shows in the PR line and the receipt', () => {
    enable();
    writeHld(root, DIR, { ...emptyHldRecord(REF), state: 'skipped', skip_reason: 'Hotfix' });
    expect(designSignOffPrLine(root, DIR)).toBe(
      'Built before high-level design sign-off. Reason: Hotfix.',
    );
    expect(designSignOffReceiptLine(root, DIR, 'full')).toContain('skipped before sign-off');
  });

  it('AC-1: with the default file or no file the PR body is unchanged and the receipt only gains the off line', () => {
    const absentLine = designSignOffReceiptLine(root, DIR, 'full');
    const absentPr = designSignOffPrLine(root, DIR);
    mkdirSync(join(root, PATHS.GIT_WORKFLOW_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.GIT_WORKFLOW_DIR, 'design-sign-off.yaml'),
      renderDefaultGitWorkflowFile('design-sign-off.yaml'),
    );
    expect(designSignOffReceiptLine(root, DIR, 'full')).toBe(absentLine);
    expect(designSignOffPrLine(root, DIR)).toBe(absentPr);
    expect(body(absentPr)).toBe(body(''));
    expect(body('')).toBe('## Summary\ns\n');
    const receipt = composeChangeReceipt({
      verdictSummary: 'ok',
      fold: null,
      designSignOff: absentLine,
    });
    expect(receipt).toBe(`ok\n> High-level design: ⚪ off for this team`);
    expect(composeChangeReceipt({ verdictSummary: 'ok', fold: null })).toBe('ok');
  });
});
