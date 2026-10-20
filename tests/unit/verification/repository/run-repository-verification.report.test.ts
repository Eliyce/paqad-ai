import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PAQAD_VERDICT } from '@/core/constants/paqad-voice.js';
import { featureReportPath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { createVerificationContext, ownInFlightChange } from '../shared.fixture.js';

const roots: string[] = [];
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-repo-report-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad/session'), { recursive: true });
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
  delete process.env.PAQAD_FEATURE_REPORT;
});

const SES = 'report-wiring-sess';

function run(root: string) {
  const context = createVerificationContext({
    project_root: root,
    verification_origin: 'hook-completion',
    verification_stage: 'backstop-completion',
  });
  ownInFlightChange(root, SES);
  return runRepositoryVerification({
    projectRoot: root,
    origin: 'hook-completion',
    prebuiltContext: { context, escalations: [] },
    hostSessionId: SES,
    now: () => '2026-01-01T00:00:00.000Z',
  });
}

describe('runRepositoryVerification — feature report (AC-5)', () => {
  it('writes report.html for the active feature and names it in the receipt', async () => {
    const root = makeProject();
    const dir = openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'A change',
      issue: null,
    });
    const verdict = await run(root);
    const reportAbs = join(root, featureReportPath(dir));
    expect(existsSync(reportAbs)).toBe(true);
    expect(verdict.reportPath).toBe(reportAbs);
    expect(verdict.receipt).toContain('Report: ');
  });

  it('re-renders report.html with the final verdict word the receipt carries', async () => {
    const root = makeProject();
    const dir = openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'A change',
      issue: null,
    });
    const verdict = await run(root);
    const html = readFileSync(join(root, featureReportPath(dir)), 'utf8');

    expect(verdict.kind).toBeDefined();
    expect(html).toContain(`verdict-pill ${verdict.kind}"`);
    expect(verdict.summary.split('\n')[0]).toContain(PAQAD_VERDICT[verdict.kind!]);
  });

  it('does NOT write the report when feature_report is off', async () => {
    const root = makeProject();
    const dir = openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Off change',
      issue: null,
    });
    process.env.PAQAD_FEATURE_REPORT = '0';
    const verdict = await run(root);
    expect(existsSync(join(root, featureReportPath(dir)))).toBe(false);
    expect(verdict.reportPath).toBeNull();
  });

  it('never lets a render failure change the verdict or exit path', async () => {
    const root = makeProject();
    const dir = openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Broken',
      issue: null,
    });
    mkdirSync(join(root, featureReportPath(dir)), { recursive: true });
    const verdict = await run(root);
    expect(verdict).toBeDefined();
    expect(verdict.reportPath).toBeNull();
    expect(typeof verdict.ok).toBe('boolean');
  });
});
