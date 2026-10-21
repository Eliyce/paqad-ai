import { describe, expect, it } from 'vitest';

import type { EvidenceLedgerRow } from '@/core/types/evidence-ledger.js';
import { ZERO_DIGEST } from '@/evidence/digests.js';
import { signReceipt } from '@/evidence/receipt/dsse.js';
import { buildInTotoStatement } from '@/evidence/receipt/statement.js';
import type { FeatureBundleExport } from '@/feature-evidence/export.js';
import { renderFeatureReportHtml } from '@/feature-evidence/report.js';
import { foldRowsWithKey } from '@/stage-evidence/fold.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

const DIR = '42-sparse-records-01KXD47JQ2AKEF8C3KCMA977NB';
const AT = '2026-07-13T10:00:00.000Z';

function render(files: FeatureBundleExport['files']): string {
  const bundle: FeatureBundleExport = { dir_name: DIR, exported_at: AT, files, strays: [] };
  const fold = foldRowsWithKey([] as SessionLedgerRow[], {
    sessionId: 's',
    changeKey: DIR,
    promptOrdinal: 0,
  });
  return renderFeatureReportHtml(bundle, fold, { generatedAt: AT });
}

function section(html: string, id: string): string {
  const start = html.indexOf(`<section class="panel" id="${id}">`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
}

describe('renderFeatureReportHtml with sparse bundle records', () => {
  it('renders plan entries that carry no fields without printing undefined', () => {
    const html = render({
      plan: {
        steps: [{}],
        risks: [{ description: 'flaky network' }, {}],
        reuse: {
          consulted: [{}, { source: 'index', query: 'slugify', target: 'src/util.ts', hits: 2 }],
          reusing: [
            {},
            { symbol: 'slugify', file: 'src/util.ts', how: 'call it' },
            { symbol: 'z', package: 'zod', how: 'schema' },
          ],
          new_constructs: [{}, { name: 'Widget', justification: 'nothing fits' }],
        },
      },
    });

    const plan = section(html, 'plan');
    expect(plan).not.toContain('undefined');
    expect(plan).toContain('<ol class="steps"><li><strong></strong> </li></ol>');
    expect(plan).toContain('Mitigation: —');
    expect(plan).toContain('flaky network');
    expect(plan).toContain(' — 0 hit(s)');
    expect(plan).toContain('<span class="tag">src/util.ts</span> — 2 hit(s)');
    expect(plan).toContain('<span class="tag">zod</span>');
    expect(plan).toContain('<strong>Widget</strong> — nothing fits');
  });

  it('skips empty reuse lists and keeps the reuse heading', () => {
    const plan = section(render({ plan: { reuse: {} } }), 'plan');
    expect(plan).toContain('<h3>Reuse</h3>');
    expect(plan).not.toContain('<h4>Consulted</h4>');
    expect(plan).not.toContain('<h4>Reusing</h4>');
    expect(plan).not.toContain('<h4>New, justified</h4>');
  });

  it('renders spec criteria, invariants and contributions with missing fields', () => {
    const html = render({
      specification: {
        frozen: { frozen_at: 'not-a-date' },
        acceptance_criteria: [{}, { criterion_id: 'AC-2', then: 'it works' }],
        invariants: [{}],
        pipeline: { findings: [{ id: 'F-1' }, {}] },
        trace: { 'FR-1': 'F-1', 'FR-2': 'F-404' },
      },
    });

    const spec = section(html, 'spec');
    expect(spec).not.toContain('undefined');
    expect(spec).toContain('Frozen');
    expect(spec).toContain('not-a-date');
    expect(spec).not.toContain('signed off by');
    expect(spec).toContain('no given/when/then recorded');
    expect(spec).toContain('<span class="gwt-k">Then</span> it works');
    expect(spec).toContain('unconfirmed');
    expect(spec).toContain('<td>FR-1</td>');
    expect(spec).not.toContain('FR-2');
  });

  it('leaves out the contribution table when no trace line matches a finding', () => {
    const spec = section(
      render({
        specification: {
          behaviour: ['FR-1'],
          pipeline: { findings: [{ id: 'F-1', role: 'qa-engineer', claim: 'x' }] },
          trace: { 'FR-1': 'F-9' },
        },
      }),
      'spec',
    );
    expect(spec).not.toContain('Who contributed what');
  });

  it('counts rule runs that carry no counts as zero findings', () => {
    const html = render({ ruleRun: [{}, { counts: { deterministic: 1 } }] });
    expect(section(html, 'rules')).toContain(
      '2 rule runs recorded, 1 finding in total (1 deterministic · 0 heuristic · 0 skipped).',
    );
  });

  it('renders delivery commits with no sha or subject and no merge commit', () => {
    const delivery = section(render({ delivery: { commits: [{}, {}] } }), 'delivery');
    expect(delivery).toContain('<p>2 commits.</p>');
    expect(delivery).toContain('<code class="sha"></code>');
    expect(delivery).not.toContain('merged as');
  });

  it('renders review findings with missing fields and an unknown verdict as written', () => {
    const review = section(
      render({ review: { verdict: 'inconclusive', findings: [{}, { severity: 'major' }] } }),
      'review',
    );
    expect(review).toContain('<strong>Inconclusive</strong>');
    expect(review).toContain('<li><span class="tag"></span> </li>');
    expect(review).toContain('<span class="tag">major</span>');
    expect(section(render({ review: { verdict: 'needs-a-second-look' } }), 'review')).toContain(
      '<strong>needs-a-second-look</strong>',
    );
    expect(section(render({ review: {} }), 'review')).toContain('No findings were raised.');
  });

  it('renders checks without a test mode, with a bare critical path and with flaky tests', () => {
    const checks = section(
      render({
        checks: {
          commands: [
            { logical_command: null, command: 'pnpm test', passed: false, duration_ms: 1200 },
          ],
          critical_path: { logical_command: null, duration_ms: 10 },
          flaky_under_parallel: [
            { test_id: 'a', file_path: null, line_number: null },
            { test_id: 'b', file_path: 'tests/b.test.ts', line_number: null },
            { test_id: 'c', file_path: 'tests/c.test.ts', line_number: 7 },
          ],
        },
      }),
      'checks',
    );
    expect(checks).not.toContain('Test mode');
    expect(checks).toContain('pnpm test');
    expect(checks).not.toContain('Critical path');
    expect(checks).toContain('<li>a</li>');
    expect(checks).toContain('(tests/b.test.ts)');
    expect(checks).toContain('(tests/c.test.ts:7)');
  });

  it('renders a test mode with a process count and without a fallback', () => {
    const checks = section(
      render({
        checks: {
          commands: [{ logical_command: 'test', command: 'x', passed: true, duration_ms: 1 }],
          mode: {
            test_mode: 'parallel',
            processes: 4,
            parallel_commands: true,
            fallback_reason: null,
          },
        },
      }),
      'checks',
    );
    expect(checks).toContain('parallel ×4');
    expect(checks).not.toContain('fell back');
  });

  it('names a fallback and leaves out a missing process count', () => {
    const checks = section(
      render({
        checks: {
          commands: [{ logical_command: 'test', command: 'x', passed: true, duration_ms: 1 }],
          mode: {
            test_mode: 'serial',
            processes: null,
            parallel_commands: false,
            fallback_reason: 'no lockfile',
          },
        },
      }),
      'checks',
    );
    expect(checks).toContain('<span class="word">serial</span>');
    expect(checks).toContain('fell back: no lockfile');
  });

  it('shows receipt rows that were skipped or carry no verdict, code or detail', () => {
    const rows = [
      { engine: 'verification-gate', content_hash: 'h1', code: 'a', verdict: 'skipped' },
      {
        engine: 'verification-gate',
        content_hash: 'h2',
        code: 'b',
        verdict: 'skipped',
        skip_kind: 'did-not-run',
      },
      { engine: 'verification-gate', content_hash: 'h3' },
    ] as unknown as EvidenceLedgerRow[];
    const statement = buildInTotoStatement({
      fileDigests: [],
      rows,
      verifierVersion: 'v',
      timeVerified: AT,
    });
    const receipt = section(
      render({
        receipt: signReceipt({ statement, prevReceiptHash: ZERO_DIGEST, mode: 'hash-chained' }),
      }),
      'receipt',
    );
    expect(receipt).toContain('not required');
    expect(receipt).toContain('did not run');
    expect(receipt).toContain('<tr><td><code></code></td>');
  });

  it('renders a multi-frame overview with a plural frame count', () => {
    const ve = section(
      render({
        visualEvidence: {
          trigger: { changed_files: [], matched_globs: [], packs: [] },
          plan: [],
          steps: [],
          gif: { file: 'flow.gif', frames: 3, frame_ms: 400 },
          skips: [],
          result: 'pass',
        },
      }),
      'visual-evidence',
    );
    expect(ve).toContain('Overview (3 frames, 400ms each)');
  });

  it('renders a single-frame overview and a failed step with no recorded failure', () => {
    const ve = section(
      render({
        visualEvidence: {
          trigger: { changed_files: [], matched_globs: [], packs: [] },
          plan: [],
          steps: [{ index: 1, caption: 'open', status: 'failed', dir: 'step-1', journey_id: 'j' }],
          gif: { file: 'flow.gif', frames: 1, frame_ms: 500 },
          skips: [],
          result: 'partial',
        },
      }),
      'visual-evidence',
    );
    expect(ve).toContain('Overview (1 frame, 500ms each)');
    expect(ve).toContain('Step 1 (open) failed: selector-not-found.');
  });
});
