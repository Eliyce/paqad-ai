import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';
import { seedFeatureRecord } from '@/feature-evidence/feature-record.js';
import { chatRagPath, featureFilePath, featureReportPath } from '@/feature-evidence/paths.js';
import { PATHS } from '@/core/constants/paths.js';
import type { BundleCompletenessConfig } from '@/feature-evidence/manifest.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-bundle-complete-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const DIR = '511-do-a-thing-01JABCDEFGHJKMNPQRSTVWXYZ0';
const UNTITLED = 'change-01JABCDEFGHJKMNPQRSTVWXYZ1';

/** Config where only the `always` files are required (every flag off). */
const ONLY_ALWAYS: BundleCompletenessConfig = {
  ruleComplianceOn: false,
  metricsEnabled: false,
  duplicationOn: false,
  featureReport: false,
  ragEnabled: false,
  enterprise: false,
  evidenceLedger: false,
  aiBom: false,
};

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

/** Write every `always`-required file into the bundle so the gate can pass. */
function writeAlwaysFiles(root: string, dir: string): void {
  seedFeatureRecord(root, dir, { adapter: 'claude-code', sessionId: 'ses_1' }); // titled → feature.json
  write(root, featureFilePath(dir, 'plan'), '{}');
  write(root, featureFilePath(dir, 'specification'), '{}');
  write(root, featureFilePath(dir, 'review'), '{}');
  write(root, featureFilePath(dir, 'stageEvidence'), '{"row":1}\n');
  write(root, featureFilePath(dir, 'delivery'), '{"branch":"feat/x"}');
}

const base = {
  sessionId: 'ses_1',
  origin: 'hook-completion',
  isFeatureDev: true,
  changeMetrics: null,
  config: ONLY_ALWAYS,
} as const;

describe('bundleCompletenessGate scope', () => {
  it('returns null when the mode is off', () => {
    const root = tempRoot();
    expect(bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode: 'off' })).toBeNull();
  });

  it('skips a non-feature-development turn', () => {
    const root = tempRoot();
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      isFeatureDev: false,
    });
    expect(gate!.status).toBe('skipped');
  });

  it('skips a turn with no active bundle', () => {
    const root = tempRoot();
    const gate = bundleCompletenessGate({ ...base, projectRoot: root, dirName: null, mode: 'strict' });
    expect(gate!.status).toBe('skipped');
  });

  it('is informational (skipped, never a hard fail) on a non-local CI origin', () => {
    const root = tempRoot();
    // Missing every file, but ci-backstop has no committed local bundle → skipped, not fail.
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      origin: 'ci-backstop',
    });
    expect(gate!.status).toBe('skipped');
    expect(gate!.detail).toContain('informational on ci-backstop');
  });
});

describe('bundleCompletenessGate verdict', () => {
  it('passes when every required file is present and valid', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode: 'strict' });
    expect(gate!.status).toBe('pass');
  });

  it('FAILS in strict when a required file is missing, naming the file + writer (AC-4)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    rmSync(join(root, featureFilePath(DIR, 'review')));
    const gate = bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode: 'strict' });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('review.json');
    expect(gate!.detail).toContain('review record');
  });

  it('surfaces the same gap as Inconclusive (never fail) in warn', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    rmSync(join(root, featureFilePath(DIR, 'delivery')));
    const gate = bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode: 'warn' });
    expect(gate!.status).toBe('inconclusive');
    expect(gate!.detail).toContain('delivery.json');
  });

  it('treats an empty/invalid required file as missing', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(root, featureFilePath(DIR, 'plan'), '   '); // present but not valid json
    const gate = bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode: 'strict' });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('plan.json');
  });

  it('FAILS when feature.json has the placeholder title and no ticket (AC-2)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, UNTITLED); // seedFeatureRecord on change-<ULID> → title `change`, issue null
    const gate = bundleCompletenessGate({ ...base, projectRoot: root, dirName: UNTITLED, mode: 'strict' });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('no title and no ticket');
  });

  it('reports flag-off files as skipped, never failed (AC-7)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode: 'strict' });
    expect(gate!.status).toBe('pass');
    expect(gate!.detail).toContain('Skipped (flag off)');
    expect(gate!.detail).toContain('report.html');
  });

  it('reports an unrecoverable RAG gap as Inconclusive (never fail), even in strict', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, ragEnabled: true },
    });
    expect(gate!.status).toBe('inconclusive');
    expect(gate!.detail).toContain('rag.jsonl');
  });

  it('counts a rag row in the _chat home as present', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    // Write a _chat rag row (the documented one-prompt lag lands early rows there).
    write(root, chatRagPath('ses_1'), '{"q":"x"}\n');
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, ragEnabled: true },
    });
    expect(gate!.status).toBe('pass');
  });

  it('backfills change-metrics from the live value and reports it (never a clean pass) (AC-8)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, metricsEnabled: true },
      changeMetrics: {
        dup_new_pct: 0,
        reuse_rate: 1,
        meaningful_changed_lines: 3,
        new_code_lines: 3,
        reused_symbols: 0,
      } as never,
    });
    expect(gate!.status).toBe('inconclusive');
    expect(gate!.detail).toContain('Backfilled (live write missed)');
    expect(gate!.detail).toContain('change-metrics.jsonl');
  });

  it('FAILS a metrics gap with no cache to backfill from', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, metricsEnabled: true },
      changeMetrics: null,
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('change-metrics.jsonl');
  });
});

describe('rule-run + duplication backfill (recovery, reported not passed)', () => {
  it('backfills rule-run from the report + drift caches', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(root, PATHS.RULE_SCRIPTS_REPORT, JSON.stringify({ counts: { deterministic: 1 }, blocking: false }));
    write(root, PATHS.RULE_SCRIPTS_DRIFT, JSON.stringify({ blocked: false, counts: { 'RS-X': 1 } }));
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, ruleComplianceOn: true },
    });
    expect(gate!.status).toBe('inconclusive');
    expect(gate!.detail).toContain('rule-run.jsonl');
  });

  it('FAILS rule-run with no report/drift cache to backfill', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, ruleComplianceOn: true },
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('rule-run.jsonl');
  });

  it('backfills duplication from its cache', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(
      root,
      PATHS.DUPLICATION_REPORT,
      JSON.stringify({
        generated_at: '2026-01-01T00:00:00.000Z',
        findings: [],
        counts: { deterministic: 0, heuristic: 0 },
        similarity_threshold: 0.9,
        min_lines: 8,
        mode: 'warn',
        blocking: false,
        elapsed_ms: 1,
        resolved_decisions: [],
      }),
    );
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, duplicationOn: true },
    });
    expect(gate!.status).toBe('inconclusive');
    expect(gate!.detail).toContain('duplication.jsonl');
  });

  it('FAILS duplication with no cache to backfill', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, duplicationOn: true },
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('duplication.jsonl');
  });
});

describe('featureReport required file', () => {
  it('FAILS when report.html is required but missing', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, featureReport: true },
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('report.html');
  });

  it('passes when the required report.html exists', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(root, featureReportPath(DIR), '<html>report</html>');
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, featureReport: true },
    });
    expect(gate!.status).toBe('pass');
  });
});
