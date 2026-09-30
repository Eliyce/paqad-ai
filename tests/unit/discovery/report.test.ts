import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readHeaderScript } from '@/feature-evidence/envelope.js';
import { discoveryReportPath, discoveryRunFilePath } from '@/discovery/paths.js';
import { recordDiscoveryStage } from '@/discovery/recorder.js';
import { renderDiscoveryReport, writeDiscoveryReport } from '@/discovery/report.js';
import { openDiscoveryRun } from '@/discovery/run-store.js';
import { DISCOVERY_DOC_TYPES } from '@/discovery/types.js';
import { writeBrief, writeHandoff, writeReadiness, writeSynthesis } from '@/discovery/writers.js';

const roots: string[] = [];
function setup(): { root: string; dirName: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-discovery-report-'));
  roots.push(root);
  const { dirName } = openDiscoveryRun(root, {
    sessionId: 'sess-A',
    title: 'Bulk <invoice> export',
    adapter: 'x',
  });
  return { root, dirName };
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('discovery report', () => {
  it('renders empty sections for a bare run and carries the envelope header', () => {
    const { root, dirName } = setup();
    const html = renderDiscoveryReport(root, dirName);
    expect(html).toContain('Discovery — Bulk &lt;invoice&gt; export'); // title escaped
    expect(html).toContain('no brief yet');
    expect(html).toContain('not handed off yet');
    const header = readHeaderScript(html);
    expect(header?.doc_type).toBe(DISCOVERY_DOC_TYPES.report);
  });

  it('renders the recorded records and a stage table', () => {
    const { root, dirName } = setup();
    const ctx = { projectRoot: root, dirName, sessionId: 'sess-A' };
    writeBrief(ctx, {
      revision: 1,
      intent: 'export invoices in bulk',
      facts: [],
      interpretations: [],
      success: ['fast'],
      constraints: [],
      open_questions: [],
      assignments: [],
    });
    writeSynthesis(ctx, {
      revision: 1,
      summary: 's',
      complementary: [],
      conflicts: [],
      recommendation: 'reuse the exporter',
      alternatives: [],
    });
    writeReadiness(ctx, {
      revision: 1,
      outcome: 'development',
      verdict: 'ready',
      blockers: ['perf unverified'],
      owners: ['perf'],
    });
    writeHandoff(ctx, {
      revision: 1,
      outcome: 'development',
      value: 'v',
      scope: 's',
      success: [],
      constraints: [],
      scenarios: [],
      decisions: [],
      next_action: 'open a feature',
      authorization: 'owner approved',
    });
    recordDiscoveryStage(root, dirName, {
      sessionId: 'sess-A',
      stage: 'understand',
      phase: 'start',
      revision: 1,
    });
    // A fully complete stage (start + end + real artifact) → 🟢 done row.
    recordDiscoveryStage(root, dirName, {
      sessionId: 'sess-A',
      stage: 'investigate',
      phase: 'start',
      revision: 1,
    });
    recordDiscoveryStage(root, dirName, {
      sessionId: 'sess-A',
      stage: 'investigate',
      phase: 'end',
      revision: 1,
      artifactPath: join('does', 'not', 'matter'),
    });
    // Give the end a real digest by pointing at an existing file.
    recordDiscoveryStage(root, dirName, {
      sessionId: 'sess-A',
      stage: 'refine',
      phase: 'start',
      revision: 1,
    });
    recordDiscoveryStage(root, dirName, {
      sessionId: 'sess-A',
      stage: 'refine',
      phase: 'end',
      revision: 1,
      artifactPath: discoveryRunFilePath(dirName, 'synthesis'),
    });
    const html = renderDiscoveryReport(root, dirName);
    expect(html).toContain('export invoices in bulk');
    expect(html).toContain('reuse the exporter');
    expect(html).toContain('perf unverified');
    expect(html).toContain('open a feature');
    expect(html).toContain('🟡 in progress');
    expect(html).toContain('🟢 done'); // refine is complete (start+end+real artifact)
  });

  it('writes report.html atomically and returns its path', () => {
    const { root, dirName } = setup();
    const rel = writeDiscoveryReport(root, dirName);
    expect(rel).toBe(discoveryReportPath(dirName));
    expect(readFileSync(join(root, rel), 'utf8')).toContain('<!doctype html>');
  });

  it('degrades gracefully when run.json is missing and a record is not an object', () => {
    const { root, dirName } = setup();
    // A non-object brief.json → treated as no brief (readJson returns null).
    writeFileSync(join(root, discoveryRunFilePath(dirName, 'brief')), '[]', 'utf8');
    // Remove run.json → run is unknown; the report still renders with fallbacks.
    rmSync(join(root, discoveryRunFilePath(dirName, 'run')));
    const html = renderDiscoveryReport(root, dirName);
    expect(html).toContain('not decided'); // outcome fallback
    expect(html).toContain('unknown'); // status fallback
    expect(html).toContain('no brief yet');
  });
});
