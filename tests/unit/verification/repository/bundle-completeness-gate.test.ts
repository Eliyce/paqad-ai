import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bundleCompletenessGate,
  recheckAfterReceiptSeal,
} from '@/verification/repository/bundle-completeness-gate.js';
import { buildBundleCompletenessConfig } from '@/verification/repository/bundle-completeness-config.js';
import { seedFeatureRecord } from '@/feature-evidence/feature-record.js';
import { appendFeatureStageRow, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import { repairChainBreak } from '@/feature-evidence/chain-repair.js';
import { stageReceiptNotes } from '@/stage-isolation/recipe-receipt.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import {
  chatRagPath,
  featureDir,
  featureFilePath,
  featureLegacySpecMarkdownPath,
  featureReportPath,
} from '@/feature-evidence/paths.js';
import {
  buildDocumentEnvelope,
  buildTextHeader,
  renderFrontMatter,
  stampBundleRow,
} from '@/feature-evidence/envelope.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { PATHS } from '@/core/constants/paths.js';
import type { BundleCompletenessConfig } from '@/feature-evidence/manifest.js';
import { summarizeStageIsolation } from '@/stage-isolation/isolation-summary.js';
import { endStage, openStageEvidence, startStage } from '@/stage-evidence/index.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-bundle-complete-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  vi.unstubAllEnvs();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const DIR = '511-do-a-thing-01JABCDEFGHJKMNPQRSTVWXYZ0';
const UNTITLED = 'change-01JABCDEFGHJKMNPQRSTVWXYZ1';

const ONLY_ALWAYS: BundleCompletenessConfig = {
  lane: 'full',
  ruleComplianceOn: false,
  metricsEnabled: false,
  duplicationOn: false,
  featureReport: false,
  ragEnabled: false,
  enterprise: false,
  evidenceLedger: false,
  aiBom: false,
  specPipelineStrict: false,
  specPipelineEnabled: false,
  expertsEnabled: false,
  specFrozenBeforePipeline: false,
  stageIsolationExpected: false,
  stageIsolationUnresolved: false,
};

function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function writeAlwaysFiles(root: string, dir: string): void {
  seedFeatureRecord(root, dir, { adapter: 'claude-code', sessionId: 'ses_1' });
  write(root, featureFilePath(dir, 'plan'), '{}');
  write(root, featureFilePath(dir, 'specification'), '{}');
  write(root, featureFilePath(dir, 'specMd'), '# Specification\n');
  write(root, featureFilePath(dir, 'review'), '{}');
  write(root, featureFilePath(dir, 'stageEvidence'), '{"row":1}\n');
  write(root, featureFilePath(dir, 'delivery'), '{"branch":"feat/x"}');
  write(root, featureFilePath(dir, 'evidence'), '{"code":"format"}\n');
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
    expect(
      bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode: 'off' }),
    ).toBeNull();
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
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: null,
      mode: 'strict',
    });
    expect(gate!.status).toBe('skipped');
    expect(gate!.skip_kind).toBe('not-required');
  });

  it('is informational (skipped, never a hard fail) on a non-local CI origin', () => {
    const root = tempRoot();
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
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
    });
    expect(gate!.status).toBe('pass');
  });

  it('FAILS in strict when a required file is missing, naming the file + writer (AC-4)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    rmSync(join(root, featureFilePath(DIR, 'review')));
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
    });
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
    write(root, featureFilePath(DIR, 'plan'), '   ');
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('plan.json');
  });

  it('FAILS when feature.json has the placeholder title and no ticket (AC-2)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, UNTITLED);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: UNTITLED,
      mode: 'strict',
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('no title and no ticket');
    expect(gate!.detail).toContain('paqad-ai feature title');
  });

  it('reports flag-off files as skipped, never failed (AC-7)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
    });
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
    write(
      root,
      PATHS.RULE_SCRIPTS_REPORT,
      JSON.stringify({ counts: { deterministic: 1 }, blocking: false }),
    );
    write(
      root,
      PATHS.RULE_SCRIPTS_DRIFT,
      JSON.stringify({ blocked: false, counts: { 'RS-X': 1 } }),
    );
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

describe('every flag on (no flag-off skip note)', () => {
  const ALL_ON: BundleCompletenessConfig = {
    ruleComplianceOn: true,
    metricsEnabled: true,
    duplicationOn: true,
    featureReport: true,
    ragEnabled: true,
    enterprise: true,
    evidenceLedger: true,
    aiBom: true,
    specPipelineStrict: false,
    specPipelineEnabled: true,
    expertsEnabled: true,
    specFrozenBeforePipeline: false,
    stageIsolationExpected: false,
    stageIsolationUnresolved: false,
  };

  it('passes with every required file present and no "Skipped (flag off)" note', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(root, featureFilePath(DIR, 'request'), '# Request\n');
    for (const key of ['clarification', 'experts'] as const) {
      write(root, featureFilePath(DIR, key), '{}');
    }
    for (const key of ['ruleRun', 'changeMetrics', 'duplication', 'rag', 'evidence'] as const) {
      write(root, featureFilePath(DIR, key), '{"row":1}\n');
    }
    for (const key of ['receipt', 'aiBom'] as const) {
      write(root, featureFilePath(DIR, key), '{}');
    }
    write(root, featureReportPath(DIR), '<html>report</html>');
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: ALL_ON,
    });
    expect(gate!.status).toBe('pass');
    expect(gate!.detail).not.toContain('Skipped (flag off)');
  });

  it('FAILS when an enterprise-required file (receipt.json) is missing', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    for (const key of ['ruleRun', 'changeMetrics', 'duplication', 'rag', 'evidence'] as const) {
      write(root, featureFilePath(DIR, key), '{"row":1}\n');
    }
    write(root, featureFilePath(DIR, 'aiBom'), '{}');
    write(root, featureReportPath(DIR), '<html>report</html>');
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: ALL_ON,
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('receipt.json');
  });
});

describe('optional checks.json', () => {
  it('passes and never names checks.json as skipped when it is absent', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: ONLY_ALWAYS,
    });
    expect(gate!.status).toBe('pass');
    expect(gate!.detail).not.toContain('checks.json');
  });

  it('counts checks.json among the present files when it exists', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(root, featureFilePath(DIR, 'checks'), '{"passed":true}');
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: ONLY_ALWAYS,
    });
    expect(gate!.status).toBe('pass');
    expect(gate!.detail).toContain('(9 checked)');
    expect(gate!.detail).not.toContain('checks.json');
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

function writeSpecPair(root: string, dir: string, body: string, specHash = sha256Hex(body)): void {
  const header = buildTextHeader({
    docType: 'paqad.spec',
    change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    sessionId: 'ses_1',
    schemaVersion: 2,
    body,
  });
  write(root, featureFilePath(dir, 'specMd'), renderFrontMatter(header, body));
  write(
    root,
    featureFilePath(dir, 'specification'),
    JSON.stringify({ spec_file: 'spec.md', spec_hash: specHash }),
  );
}

describe('spec.md signed source', () => {
  const run = (root: string, mode: 'strict' | 'warn' = 'strict') =>
    bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode, config: ONLY_ALWAYS });

  it('passes when the spec.md body hashes to specification.json spec_hash', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    writeSpecPair(root, DIR, '# Spec\n\n- FR-1: x\n');
    expect(run(root)!.status).toBe('pass');
  });

  it('fails by name when the spec.md body was edited after the freeze', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    writeSpecPair(root, DIR, '# Spec\n\n- FR-1: y\n', sha256Hex('# Spec\n\n- FR-1: x\n'));
    const gate = run(root);
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain(
      'spec.md (its body does not hash to specification.json spec_hash)',
    );
  });

  it('fails closed when spec.md is missing from a bundle frozen in the current evidence shape', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    writeSpecPair(root, DIR, '# Spec\n');
    rmSync(join(root, featureFilePath(DIR, 'specMd')));
    const gate = run(root);
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('spec.md (run: paqad-ai spec freeze)');
    expect(run(root, 'warn')!.status).toBe('inconclusive');
  });

  it('treats a blank spec.md as missing', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(root, featureFilePath(DIR, 'specMd'), '   \n');
    expect(run(root)!.status).toBe('fail');
  });

  it('accepts a legacy-shape bundle: old spec_file and a specification.md projection, no spec.md', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    rmSync(join(root, featureFilePath(DIR, 'specMd')));
    write(
      root,
      featureFilePath(DIR, 'specification'),
      JSON.stringify({ spec_file: '.paqad/tmp/old-spec.md', spec_hash: 'a'.repeat(64) }),
    );
    write(root, featureLegacySpecMarkdownPath(DIR), '# Specification\n');
    expect(run(root)!.status).toBe('pass');
  });

  it('does not accept the legacy projection for a record that names spec.md', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    writeSpecPair(root, DIR, '# Spec\n');
    rmSync(join(root, featureFilePath(DIR, 'specMd')));
    write(root, featureLegacySpecMarkdownPath(DIR), '# Specification\n');
    expect(run(root)!.status).toBe('fail');
  });

  it('does not accept a blank legacy projection, or a legacy record with no projection', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    rmSync(join(root, featureFilePath(DIR, 'specMd')));
    write(
      root,
      featureFilePath(DIR, 'specification'),
      JSON.stringify({ spec_file: '.paqad/tmp/old-spec.md' }),
    );
    expect(run(root)!.status).toBe('fail');
    write(root, featureLegacySpecMarkdownPath(DIR), '  \n');
    expect(run(root)!.status).toBe('fail');
  });

  it('reports a missing spec.md once, and no hash mismatch, when specification.json is unreadable', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(root, featureFilePath(DIR, 'specification'), 'not json');
    const gate = run(root);
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('specification.json (run: paqad-ai spec freeze)');
    expect(gate!.detail).not.toContain('does not hash');
    rmSync(join(root, featureFilePath(DIR, 'specMd')));
    expect(run(root)!.detail).toContain('spec.md (run: paqad-ai spec freeze)');
  });

  it('names only specification.json when it is absent beside a present spec.md', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    rmSync(join(root, featureFilePath(DIR, 'specification')));
    const gate = run(root);
    expect(gate!.detail).toContain('specification.json (run: paqad-ai spec freeze)');
    expect(gate!.detail).not.toContain('spec.md (');
  });

  it('reads a JSON null specification.json as no record', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(root, featureFilePath(DIR, 'specification'), 'null');
    expect(run(root)!.status).toBe('pass');
  });
});

describe('spec pipeline files', () => {
  const run = (root: string, config: BundleCompletenessConfig) =>
    bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode: 'strict', config });

  it('requires request.md and clarification.json when the pipeline is on (M2)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = run(root, { ...ONLY_ALWAYS, specPipelineEnabled: true });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('request.md');
    expect(gate!.detail).toContain('clarification.json');
    expect(gate!.detail).not.toContain('experts.json (run');
    write(root, featureFilePath(DIR, 'request'), '# Request\n');
    write(root, featureFilePath(DIR, 'clarification'), '{}');
    expect(run(root, { ...ONLY_ALWAYS, specPipelineEnabled: true })!.status).toBe('pass');
  });

  it('requires experts.json when both the pipeline and experts are on (M3)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(root, featureFilePath(DIR, 'request'), '# Request\n');
    write(root, featureFilePath(DIR, 'clarification'), '{}');
    const config = { ...ONLY_ALWAYS, specPipelineEnabled: true, expertsEnabled: true };
    const gate = run(root, config);
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('experts.json');
    write(root, featureFilePath(DIR, 'experts'), '{}');
    expect(run(root, config)!.status).toBe('pass');
  });

  it('never requires experts.json with experts on and the pipeline off (M5, AC-21)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = run(root, { ...ONLY_ALWAYS, expertsEnabled: true });
    expect(gate!.status).toBe('pass');
    expect(gate!.detail).not.toContain('missing');
  });

  it('checks decisions.json when present and never requires it', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    expect(run(root, ONLY_ALWAYS)!.detail).not.toContain('decisions.json');
    write(root, featureFilePath(DIR, 'decisions'), '{}');
    expect(run(root, ONLY_ALWAYS)!.status).toBe('pass');
  });
});

describe('lane-aware spec pipeline files', () => {
  const LANE_DIR = '640-lane-01JABCDEFGHJKMNPQRSTVWXYZ2';

  function configFor(root: string, lane: 'fast' | 'graduated' | 'full' | null) {
    seedFeatureRecord(root, LANE_DIR, { adapter: 'claude-code', sessionId: 'ses_1', lane });
    const built = buildBundleCompletenessConfig(root, 'ses_1', LANE_DIR);
    expect(built.lane).toBe(lane);
    return {
      ...ONLY_ALWAYS,
      lane: built.lane,
      specPipelineEnabled: built.specPipelineEnabled,
      specPipelineStrict: built.specPipelineStrict,
      expertsEnabled: built.expertsEnabled,
    };
  }
  const run = (root: string, config: BundleCompletenessConfig) =>
    bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: LANE_DIR,
      mode: 'strict',
      config,
    });

  it('passes a fast-lane change with no pipeline, spec or review files', () => {
    const root = tempRoot();
    const config = configFor(root, 'fast');
    expect([config.specPipelineEnabled, config.expertsEnabled]).toEqual([true, true]);
    writeAlwaysFiles(root, LANE_DIR);
    const gate = run(root, config);
    expect(gate!.status).toBe('pass');
    expect(gate!.detail).toContain(
      'Not required on the fast lane: clarification.json, experts.json, request.md, review.json, spec.md, specification.json.',
    );
    expect(gate!.detail).not.toContain('Skipped (flag off): clarification.json');
  });

  it.each([
    ['graduated', 'graduated'],
    ['unresolved', null],
  ] as const)('fails a %s-lane change without them, naming each missing file', (_n, lane) => {
    const root = tempRoot();
    const config = configFor(root, lane);
    writeAlwaysFiles(root, LANE_DIR);
    const gate = run(root, config);
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('request.md (run: paqad-ai spec pipeline start)');
    expect(gate!.detail).toContain('clarification.json');
    expect(gate!.detail).toContain('experts.json');
  });

  function frozenConfigFor(root: string, lane: 'fast' | 'graduated', spec: unknown) {
    seedFeatureRecord(root, LANE_DIR, { adapter: 'claude-code', sessionId: 'ses_1', lane });
    writeAlwaysFiles(root, LANE_DIR);
    write(root, featureFilePath(LANE_DIR, 'specification'), JSON.stringify(spec));
    const built = buildBundleCompletenessConfig(root, 'ses_1', LANE_DIR);
    return {
      ...ONLY_ALWAYS,
      lane: built.lane,
      specPipelineEnabled: built.specPipelineEnabled,
      specPipelineStrict: built.specPipelineStrict,
      expertsEnabled: built.expertsEnabled,
      specFrozenBeforePipeline: built.specFrozenBeforePipeline,
    };
  }

  it('passes a graduated change whose spec was frozen before the pipeline was on', () => {
    const root = tempRoot();
    const config = frozenConfigFor(root, 'graduated', { spec_file: 'spec.md' });
    expect(config.specFrozenBeforePipeline).toBe(true);
    expect(config.specPipelineStrict).toBe(true);
    const gate = run(root, config);
    expect(gate!.status).toBe('pass');
    expect(gate!.detail).toContain(
      'Spec frozen before the spec pipeline was on, so not required: clarification.json, experts.json, request.md.',
    );
    expect(gate!.detail).not.toMatch(/spec_pipeline_adoption=strict/);
  });

  it('still names the fast lane, not the switch, for a fast-lane spec with no pipeline record', () => {
    const root = tempRoot();
    const config = frozenConfigFor(root, 'fast', { spec_file: 'spec.md' });
    const gate = run(root, config);
    expect(gate!.status).toBe('pass');
    expect(gate!.detail).toContain('Not required on the fast lane:');
    expect(gate!.detail).not.toContain('Spec frozen before the spec pipeline was on');
  });

  it('passes a fast-lane freeze on the fast lane, then asks for a re-freeze once the lane is raised', () => {
    const root = tempRoot();
    const fastSpec = { spec_file: 'spec.md', pipeline: { produced: false, skipped: 'fast-lane' } };
    const fast = frozenConfigFor(root, 'fast', fastSpec);
    expect(fast.specFrozenBeforePipeline).toBe(false);
    const fastGate = run(root, fast);
    expect(fastGate!.status).toBe('pass');
    expect(fastGate!.detail).toContain('Not required on the fast lane:');

    recordChangeConstants(root, LANE_DIR, { lane: 'graduated' });
    const built = buildBundleCompletenessConfig(root, 'ses_1', LANE_DIR);
    expect(built.lane).toBe('graduated');
    expect(built.specFrozenBeforePipeline).toBe(false);
    const raised = {
      ...fast,
      lane: built.lane,
      specFrozenBeforePipeline: built.specFrozenBeforePipeline,
    };
    const gate = run(root, raised);
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain(
      'request.md (run: the lane was raised after a fast-lane freeze: re-freeze the spec through the spec pipeline',
    );
    expect(gate!.detail).toContain('clarification.json (run: the lane was raised');
    expect(gate!.detail).toContain('specification.json was frozen on the fast lane');
    expect(gate!.detail).not.toContain('Spec frozen before the spec pipeline was on');
  });

  it('fails a pipeline-era change without the pipeline files, naming each one', () => {
    const root = tempRoot();
    const config = frozenConfigFor(root, 'graduated', { pipeline: { produced: true } });
    expect(config.specFrozenBeforePipeline).toBe(false);
    const gate = run(root, config);
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('request.md (run: paqad-ai spec pipeline start)');
    expect(gate!.detail).toContain('clarification.json');
  });

  it('treats a strict --manual --reason freeze as before: recorded, files still required', () => {
    const root = tempRoot();
    const config = frozenConfigFor(root, 'graduated', {
      pipeline: { produced: false, manual_reason: 'hand-written hotfix spec' },
    });
    expect(config.specFrozenBeforePipeline).toBe(false);
    const gate = run(root, config);
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('request.md');
    expect(gate!.detail).not.toMatch(/spec_pipeline_adoption=strict/);
    write(root, featureFilePath(LANE_DIR, 'request'), '# Request\n');
    write(root, featureFilePath(LANE_DIR, 'clarification'), '{}');
    write(root, featureFilePath(LANE_DIR, 'experts'), '{}');
    expect(run(root, config)!.status).toBe('pass');
  });

  it('applies the strict provenance check off the fast lane only', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const strict = { ...ONLY_ALWAYS, specPipelineStrict: true };
    const gateFor = (lane: BundleCompletenessConfig['lane']) =>
      bundleCompletenessGate({
        ...base,
        projectRoot: root,
        dirName: DIR,
        mode: 'strict',
        config: { ...strict, lane },
      });
    expect(gateFor('fast')!.status).toBe('pass');
    expect(gateFor('graduated')!.detail).toMatch(/spec_pipeline_adoption=strict/);
    expect(gateFor(null)!.status).toBe('fail');
  });
});

describe('evidence.jsonl written by this run', () => {
  it('counts an absent evidence.jsonl as present when the late-gate rows are pending', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    rmSync(join(root, featureFilePath(DIR, 'evidence')));
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      evidenceRowsPending: true,
    });
    expect(gate!.status).toBe('pass');
  });

  it('fails an absent evidence.jsonl when no rows will be appended', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    rmSync(join(root, featureFilePath(DIR, 'evidence')));
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      evidenceRowsPending: false,
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('evidence.jsonl');
  });
});

describe('receipt.json and ai-bom.json sealed by this run', () => {
  const ENTERPRISE = { ...ONLY_ALWAYS, enterprise: true, evidenceLedger: true, aiBom: true };

  it('counts an absent receipt and AI-BOM as present when this run seals them', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: ENTERPRISE,
      receiptPending: true,
    });
    expect(gate!.status).toBe('pass');
  });

  it('fails an absent receipt and AI-BOM when no seal follows', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: ENTERPRISE,
      receiptPending: false,
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('receipt.json');
    expect(gate!.detail).toContain('ai-bom.json');
  });

  describe('recheckAfterReceiptSeal', () => {
    function pendingInput(root: string) {
      return {
        ...base,
        projectRoot: root,
        dirName: DIR,
        mode: 'strict' as const,
        config: ENTERPRISE,
        receiptPending: true,
      };
    }

    it('keeps the gate when the seal was written', () => {
      const root = tempRoot();
      writeAlwaysFiles(root, DIR);
      const input = pendingInput(root);
      const gate = bundleCompletenessGate(input);
      expect(recheckAfterReceiptSeal(gate, input, true)).toBe(gate);
    });

    it('re-judges without the allowance when the seal failed, so strict fails on the receipt', () => {
      const root = tempRoot();
      writeAlwaysFiles(root, DIR);
      const input = pendingInput(root);
      const gate = bundleCompletenessGate(input);
      expect(gate!.status).toBe('pass');

      const rechecked = recheckAfterReceiptSeal(gate, input, false);

      expect(rechecked!.status).toBe('fail');
      expect(rechecked!.detail).toContain('receipt.json');
      expect(rechecked!.detail).toContain('ai-bom.json');
    });

    it('keeps a gate that never relied on the seal, and a missing gate', () => {
      const root = tempRoot();
      writeAlwaysFiles(root, DIR);
      const input = { ...pendingInput(root), receiptPending: false };
      const gate = bundleCompletenessGate(input);
      expect(recheckAfterReceiptSeal(gate, input, false)).toBe(gate);
      expect(recheckAfterReceiptSeal(null, pendingInput(root), false)).toBeNull();
    });
  });
});

describe('spec pipeline strict adoption gate', () => {
  const STRICT = { ...ONLY_ALWAYS, specPipelineStrict: true };

  it('fails closed under strict when specification.json records no pipeline provenance', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: STRICT,
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toMatch(/spec_pipeline_adoption=strict/);
  });

  it('passes under strict with a pipeline-produced spec', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(
      root,
      featureFilePath(DIR, 'specification'),
      JSON.stringify({ pipeline: { produced: true } }),
    );
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: STRICT,
    });
    expect(gate!.status).toBe('pass');
  });

  it('passes under strict with a manual reason', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(
      root,
      featureFilePath(DIR, 'specification'),
      JSON.stringify({ pipeline: { produced: false, manual_reason: 'hotfix' } }),
    );
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: STRICT,
    });
    expect(gate!.status).toBe('pass');
  });

  it('does not apply the check under warn (specPipelineStrict off)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: ONLY_ALWAYS,
    });
    expect(gate!.status).toBe('pass');
  });
});

describe('the isolation evidence stream', () => {
  function graduatedInlineGate(root: string) {
    writeAlwaysFiles(root, DIR);
    recordChangeConstants(root, DIR, { adapter: 'claude-code', lane: 'graduated' });
    const built = buildBundleCompletenessConfig(root, 'ses_1', DIR);
    return bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: {
        ...ONLY_ALWAYS,
        lane: built.lane,
        stageIsolationExpected: built.stageIsolationExpected,
        stageIsolationUnresolved: built.stageIsolationUnresolved,
      },
    });
  }

  it('AC-1: passes a graduated change run inline under the default stage_isolation_lanes', () => {
    const gate = graduatedInlineGate(tempRoot());

    expect(gate!.status).toBe('pass');
  });

  it('AC-3: fails the same graduated change when stage_isolation_lanes names graduated', () => {
    vi.stubEnv('PAQAD_STAGE_ISOLATION_LANES', 'graduated,full');
    const gate = graduatedInlineGate(tempRoot());

    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('stage-agent rows in stage-evidence.jsonl');
  });

  it('fails a graduated/full change on a subagent-capable host with no isolation evidence', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);

    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, stageIsolationExpected: true },
    });

    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('stage-agent rows in stage-evidence.jsonl');
    expect(gate!.remediation).toContain('stage-agent rows in stage-evidence.jsonl');
    expect(gate!.detail).not.toContain('context-efficiency.jsonl');
  });

  describe('after a forward-only raise', () => {
    const RAISED_AT = '2026-10-29T12:10:00.000Z';
    function agentRow(at: string): string {
      return `{"kind":"stage-agent","stage":"review","doc_type":"paqad.stage-evidence","session_id":"ses_1","recorded_at":"${at}","content_hash":"h"}\n`;
    }
    function gateWith(rows: string) {
      const root = tempRoot();
      writeAlwaysFiles(root, DIR);
      write(root, featureFilePath(DIR, 'stageEvidence'), `{"kind":"open"}\n${rows}`);
      return bundleCompletenessGate({
        ...base,
        projectRoot: root,
        dirName: DIR,
        mode: 'strict',
        config: { ...ONLY_ALWAYS, stageIsolationExpected: true, stageIsolationSince: RAISED_AT },
      });
    }

    it('AC-13: reads complete with a stage helper row after the raise', () => {
      expect(
        gateWith(agentRow('2026-10-29T12:00:00.000Z') + agentRow('2026-10-29T12:12:00.000Z'))!
          .status,
      ).toBe('pass');
    });

    it('AC-13: fails when the only stage helper rows came before the raise', () => {
      const gate = gateWith(agentRow('2026-10-29T12:00:00.000Z'));
      expect(gate!.status).toBe('fail');
      expect(gate!.detail).toContain('stage-agent rows in stage-evidence.jsonl');
    });
  });

  it('passes that same change once the stage-agent rows are there', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(
      root,
      featureFilePath(DIR, 'stageEvidence'),
      '{"kind":"open"}\n{"kind":"stage-agent","stage":"planning","doc_type":"paqad.stage-evidence","session_id":"ses_1","recorded_at":"2026-09-01T00:00:00.000Z","content_hash":"h"}\n',
    );

    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, stageIsolationExpected: true },
    });

    expect(gate!.status).toBe('pass');
  });

  it('AC-36: passes a change where one agent ran planning and specification', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const row = (fields: Record<string, unknown>) =>
      JSON.stringify({
        doc_type: 'paqad.stage-evidence',
        session_id: 'ses_1',
        recorded_at: '2026-09-01T00:00:00.000Z',
        content_hash: 'h',
        ...fields,
      });
    write(
      root,
      featureFilePath(DIR, 'stageEvidence'),
      [
        row({ kind: 'stage_start', stage: 'planning', agent_id: 'agent-p1' }),
        row({ kind: 'stage_end', stage: 'planning' }),
        row({ kind: 'stage_start', stage: 'specification', agent_id: 'agent-p1' }),
        row({ kind: 'stage_end', stage: 'specification' }),
        row({
          kind: 'stage-agent',
          stage: 'planning',
          stages: ['planning', 'specification'],
          agent: 'paqad-planning',
          agent_id: 'agent-p1',
          event_status: 'completed',
          tokens_not_recarried: 900,
        }),
      ].join('\n') + '\n',
    );
    write(root, `${featureDir(DIR)}/high-table.jsonl`, '{"kind":"seated","role":"qa-engineer"}\n');

    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, stageIsolationExpected: true },
    });

    expect(gate!.status).toBe('pass');
    expect(summarizeStageIsolation(root, DIR)).toMatchObject({
      stages: 2,
      tokensNotRecarried: 900,
    });
  });

  it('AC-42: a High Table seat row is not stage-agent evidence, so the change still fails by name', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(
      root,
      featureFilePath(DIR, 'stageEvidence'),
      '{"kind":"open"}\n{"kind":"stage-agent","stage":"expert","agent":"paqad-expert","doc_type":"paqad.stage-evidence","session_id":"ses_1","recorded_at":"2026-09-01T00:00:00.000Z","content_hash":"h"}\n',
    );
    write(
      root,
      `${featureDir(DIR)}/context-efficiency.jsonl`,
      '{"stage":"chief_architect","doc_type":"paqad.context-efficiency","session_id":"ses_1","ts":"2026-01-01T00:00:00.000Z","content_hash":"h"}\n',
    );

    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, stageIsolationExpected: true },
    });

    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('stage-agent rows in stage-evidence.jsonl');
  });

  it('still accepts a legacy-shape bundle that recorded isolation in context-efficiency.jsonl', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(
      root,
      `${featureDir(DIR)}/context-efficiency.jsonl`,
      '{"stage":"planning","doc_type":"paqad.context-efficiency","session_id":"ses_1","ts":"2026-01-01T00:00:00.000Z","content_hash":"h"}\n',
    );

    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, stageIsolationExpected: true },
    });

    expect(gate!.status).toBe('pass');
  });

  it('does not fail a change that never expected isolation (INV-2)', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);

    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, stageIsolationExpected: false },
    });

    expect(gate!.status).toBe('pass');
  });

  it('never calls the absent stream a flag-off skip, because isolation has no flag', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);

    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, stageIsolationExpected: false },
    });

    expect(gate!.detail).not.toContain('context-efficiency.jsonl');
  });

  it('surfaces an unresolved lane as Inconclusive, not a clean green', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);

    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, stageIsolationUnresolved: true },
    });

    expect(gate!.status).toBe('inconclusive');
    expect(gate!.detail).toContain('Not classified — isolation not verified');
    expect(gate!.detail).toContain('paqad-ai lane set');
  });

  it('does not surface an unresolved-lane note once isolation actually ran', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    write(
      root,
      featureFilePath(DIR, 'stageEvidence'),
      '{"kind":"open"}\n{"kind":"stage-agent","stage":"planning","doc_type":"paqad.stage-evidence","session_id":"ses_1","recorded_at":"2026-09-01T00:00:00.000Z","content_hash":"h"}\n',
    );

    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config: { ...ONLY_ALWAYS, stageIsolationUnresolved: true },
    });

    expect(gate!.status).toBe('pass');
    expect(gate!.detail).not.toContain('isolation not verified');
  });
});

describe('bundleCompletenessGate content_hash backstop', () => {
  const identity = { change: '01JABCDEFGHJKMNPQRSTVWXYZ0', sessionId: 'ses_1', schemaVersion: 1 };

  function run(root: string, config: BundleCompletenessConfig = ONLY_ALWAYS) {
    return bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
      config,
    });
  }

  it('passes a bundle whose stamped documents and rows are untouched', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const row = stampBundleRow({
      ...identity,
      docType: 'paqad.stage-evidence',
      row: { stage: 'x' },
    });
    write(root, featureFilePath(DIR, 'stageEvidence'), `${JSON.stringify(row)}\n\nnot json\n`);
    expect(run(root)!.status).toBe('pass');
  });

  it('fails a hand-edited document and names it', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const doc = buildDocumentEnvelope({ ...identity, docType: 'paqad.plan', body: { title: 'A' } });
    write(root, featureFilePath(DIR, 'plan'), JSON.stringify({ ...doc, title: 'B' }));
    const gate = run(root)!;
    expect(gate.status).toBe('fail');
    expect(gate.detail).toContain('plan.json (content_hash mismatch at the document');
    expect(gate.detail).toContain('paqad-ai plan compile');
  });

  it('fails a hand-edited JSONL row and names the file and line', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const good = stampBundleRow({
      ...identity,
      docType: 'paqad.stage-evidence',
      row: { stage: 'a' },
    });
    const bad = {
      ...stampBundleRow({ ...identity, docType: 'paqad.stage-evidence', row: { stage: 'b' } }),
      stage: 'c',
    };
    write(
      root,
      featureFilePath(DIR, 'stageEvidence'),
      `${JSON.stringify(good)}\n${JSON.stringify(bad)}\n`,
    );
    const gate = run(root)!;
    expect(gate.status).toBe('fail');
    expect(gate.detail).toContain('stage-evidence.jsonl (content_hash mismatch at line 2');
  });

  it('fails a Markdown document whose body no longer matches its front matter', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const header = buildTextHeader({ ...identity, docType: 'paqad.spec', body: '# Spec\n' });
    write(root, featureFilePath(DIR, 'specMd'), renderFrontMatter(header, '# Edited\n'));
    const gate = run(root)!;
    expect(gate.status).toBe('fail');
    expect(gate.detail).toContain('spec.md (content_hash mismatch at its body');
  });

  it('checks a present optional document too', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const doc = buildDocumentEnvelope({ ...identity, docType: 'paqad.checks', body: { ok: true } });
    write(root, featureFilePath(DIR, 'checks'), JSON.stringify({ ...doc, ok: false }));
    const gate = run(root)!;
    expect(gate.status).toBe('fail');
    expect(gate.detail).toContain('checks.json (content_hash mismatch at the document');
  });

  it('never checks report.html, a derived view', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    const header = buildTextHeader({ ...identity, docType: 'paqad.report', body: '<p>x</p>' });
    write(root, featureReportPath(DIR), renderFrontMatter(header, '<p>edited</p>'));
    expect(run(root, { ...ONLY_ALWAYS, featureReport: true })!.status).toBe('pass');
  });
});

describe('bundleCompletenessGate with the change split across two bundles', () => {
  const ctx = { sessionId: 'ses_1', adapter: 'claude-code' } as const;

  function bundleWithPlanningWork(root: string, sessionId: string): string {
    const other = openStageEvidence(root, { ...ctx, sessionId }).dirName;
    write(root, 'notes/plan-input.json', '{"steps":["one"]}');
    startStage(root, 'planning', { ...ctx, sessionId, dirName: other });
    endStage(
      root,
      'planning',
      { artifactPaths: ['notes/plan-input.json'] },
      { ...ctx, sessionId, dirName: other },
    );
    return other;
  }

  it('reads Inconclusive and names both bundles when the judged one is empty and this session owns another with work', () => {
    const root = tempRoot();
    const other = bundleWithPlanningWork(root, 'ses_1');
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
    });
    expect(gate!.status).toBe('inconclusive');
    expect(gate!.detail).toContain(DIR);
    expect(gate!.detail).toContain(other);
    expect(gate!.detail).toContain(`paqad-ai resume --feature ${other}`);
  });

  it('passes when the other unfinished bundle belongs to another session', () => {
    const root = tempRoot();
    bundleWithPlanningWork(root, 'ses_other');
    writeAlwaysFiles(root, DIR);
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
    });
    expect(gate!.status).toBe('pass');
  });

  it('passes when the judged bundle holds recorded work of its own', () => {
    const root = tempRoot();
    bundleWithPlanningWork(root, 'ses_1');
    writeAlwaysFiles(root, DIR);
    write(root, 'notes/own-plan.json', '{"steps":["two"]}');
    startStage(root, 'planning', { ...ctx, dirName: DIR });
    endStage(
      root,
      'planning',
      { artifactPaths: ['notes/own-plan.json'] },
      { ...ctx, dirName: DIR },
    );
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
    });
    expect(gate!.status).toBe('pass');
  });
});

describe('bundleCompletenessGate asks each stage for its recipe proof', () => {
  const config = { ...ONLY_ALWAYS, stageIsolationExpected: true };
  const gate = (root: string) =>
    bundleCompletenessGate({ ...base, config, projectRoot: root, dirName: DIR, mode: 'strict' })!;
  const add = (root: string, row: Record<string, unknown>) =>
    appendFeatureStageRow(root, 'ses_1', DIR, row);
  const agentRow = (stage: string) => ({
    kind: 'stage-agent',
    stage,
    event_status: 'completed',
    agent_id: 'a1',
    tokens_used: 0,
    tokens_not_recarried: 0,
    estimate: true,
  });
  const injected = (stage: string) => ({
    kind: 'recipe-injected',
    stage,
    recipe: 'r',
    recipe_hash: 'h',
  });
  const used = (stage: string) => ({
    kind: 'skill-used',
    stage,
    recipe: 'r',
    source: 'script',
    script: 's',
    output_hash: 'h',
  });

  function started(stage: string): string {
    const root = tempRoot();
    mkdirSync(join(root, featureDir(DIR)), { recursive: true });
    add(root, { kind: 'open' });
    add(root, { kind: 'stage_start', stage });
    return root;
  }

  it('AC-50: fails a development stage with no skill-used row, naming development', () => {
    const root = started('development');
    add(root, agentRow('development'));
    add(root, injected('development'));
    const result = gate(root);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('recipe proof for development');
  });

  it('FR-89: the hold names the install fix and the command that writes the proof', () => {
    const root = started('development');
    add(root, agentRow('development'));
    add(root, injected('development'));
    const { detail } = gate(root);
    expect(detail).toContain('npm i -g paqad-ai@latest');
    expect(detail).toContain('paqad-ai update');
    expect(detail).toContain('Then dispatch the paqad-development agent');
    expect(detail).toContain('runs paqad-ai stage end development');
  });

  it.each([
    ['planning', 'paqad-ai plan compile, then paqad-ai stage end planning'],
    ['specification', 'paqad-ai spec freeze, then paqad-ai stage end specification'],
    ['review', 'paqad-ai review record, then paqad-ai stage end review'],
  ])('FR-89: the %s hold names the verb that writes its skill-used row', (stage, command) => {
    const root = started(stage);
    add(root, agentRow(stage));
    add(root, injected(stage));
    expect(gate(root).detail).toContain(command);
  });

  it('does not name a stage that has all its proof', () => {
    const root = started('development');
    add(root, agentRow('development'));
    add(root, injected('development'));
    add(root, used('development'));
    expect(gate(root).detail).not.toContain('recipe proof for');
  });

  it('asks checks only for the injected row on Claude Code', () => {
    const root = started('checks');
    add(root, agentRow('checks'));
    add(root, injected('checks'));
    expect(gate(root).detail).not.toContain('recipe proof for');
  });

  it('AC-53: does not ask a Codex change for injection, takes the digest for checks, and the receipt says so', () => {
    const root = started('development');
    seedFeatureRecord(root, DIR, { adapter: 'codex-cli', sessionId: 'ses_1', lane: 'full' });
    add(root, agentRow('development'));
    add(root, used('development'));
    add(root, { kind: 'stage_start', stage: 'checks' });
    add(root, agentRow('checks'));
    add(root, {
      kind: 'stage_end',
      stage: 'checks',
      artifact_digest: 'd',
      artifact_paths: ['x/checks.json'],
    });
    expect(gate(root).detail).not.toContain('recipe proof for');
    expect(stageReceiptNotes(root, DIR).join(' ')).toContain('recipe read, not injected');
  });

  it('AC-56: warns about a stage that ran before the update, and fails one after it', () => {
    const root = tempRoot();
    const ledger = join(root, featureFilePath(DIR, 'stageEvidence'));
    mkdirSync(dirname(ledger), { recursive: true });
    writeFileSync(
      ledger,
      `${JSON.stringify({
        schema_version: 2,
        doc_type: 'paqad.stage-evidence',
        kind: 'stage_start',
        stage: 'planning',
        content_hash: 'a',
        session_id: 's',
        agent: 'orchestrator',
        recorded_at: '2026-11-01T10:00:00.000Z',
      })}\n`,
    );
    add(root, { kind: 'stage_start', stage: 'review' });
    const result = gate(root);
    expect(result.detail).toContain('ran before the update and hold no recipe proof: planning');
    expect(result.detail).toContain('recipe proof for review');
    expect(result.detail).not.toContain('recipe proof for planning');
  });

  it('asks nothing on another lane', () => {
    const root = started('development');
    const fast = bundleCompletenessGate({
      ...base,
      config: { ...config, lane: 'fast' },
      projectRoot: root,
      dirName: DIR,
      mode: 'strict',
    })!;
    expect(fast.detail).not.toContain('recipe proof for');
  });
});

describe('bundleCompletenessGate reads the ledger chain', () => {
  function chainRoot(): { root: string; ledger: string } {
    const root = tempRoot();
    const ledger = join(root, featureFilePath(DIR, 'stageEvidence'));
    mkdirSync(dirname(ledger), { recursive: true });
    for (const row of [
      { kind: 'open' },
      { kind: 'stage_start', stage: 'planning' },
      { kind: 'stage_start', stage: 'review' },
    ]) {
      appendFeatureStageRow(root, 'ses_1', DIR, row);
    }
    return { root, ledger };
  }

  function gate(root: string) {
    return bundleCompletenessGate({ ...base, projectRoot: root, dirName: DIR, mode: 'strict' })!;
  }

  it('AC-37: fails a version 3 bundle with a row removed from the middle, naming the row', () => {
    const { root, ledger } = chainRoot();
    const lines = readFileSync(ledger, 'utf8').trimEnd().split('\n');
    writeFileSync(ledger, `${[lines[0], lines[2]].join('\n')}\n`);
    const result = gate(root);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('chain broken at row 2');
  });

  it('names a working repair command, and a repair row naming the broken row clears the fail', () => {
    const { root, ledger } = chainRoot();
    const lines = readFileSync(ledger, 'utf8').trimEnd().split('\n');
    writeFileSync(ledger, `${[lines[0], lines[2]].join('\n')}\n`);
    const broken = gate(root);
    expect(JSON.stringify(broken)).toContain('paqad-ai stage repair 2');
    expect(repairChainBreak(root, 'ses_1', DIR, 1, 'nothing broke').ok).toBe(false);
    expect(repairChainBreak(root, 'ses_1', DIR, 2, 'a row was lost in a crash').ok).toBe(true);
    const repaired = gate(root);
    expect(repaired.detail).not.toContain('chain broken');
    expect(repaired.detail).toContain('a row was lost in a crash');
  });

  it('a repair row does not clear a row that changed after it was named', () => {
    const { root, ledger } = chainRoot();
    const lines = readFileSync(ledger, 'utf8').trimEnd().split('\n');
    writeFileSync(ledger, `${[lines[0], lines[2]].join('\n')}\n`);
    repairChainBreak(root, 'ses_1', DIR, 2, 'first repair');
    const next = readFileSync(ledger, 'utf8').trimEnd().split('\n');
    const edited = { ...(JSON.parse(next[1]!) as Record<string, unknown>), content_hash: 'other' };
    next[1] = JSON.stringify(edited);
    writeFileSync(ledger, `${next.join('\n')}\n`);
    expect(gate(root).detail).toContain('chain broken');
  });

  it('reports a declared gap as a note and adds no chain failure', () => {
    const { root, ledger } = chainRoot();
    const lockHeld = join(root, featureDir(DIR), '.lock');
    mkdirSync(lockHeld);
    appendFeatureStageRow(root, 'ses_1', DIR, { kind: 'stage_start', stage: 'checks' });
    expect(readFileSync(ledger, 'utf8')).toContain('lock-timeout');
    expect(gate(root).detail).not.toContain('chain broken');
  });

  it('only warns about a break in a bundle from before the chain', () => {
    const root = tempRoot();
    const ledger = join(root, featureFilePath(DIR, 'stageEvidence'));
    mkdirSync(dirname(ledger), { recursive: true });
    const v2 = JSON.stringify({
      schema_version: 2,
      kind: 'open',
      content_hash: 'a',
      session_id: 's',
    });
    const v3 = JSON.stringify({
      schema_version: 3,
      kind: 'stage_start',
      content_hash: 'b',
      prev_hash: 'not-a',
      session_id: 's',
    });
    writeFileSync(ledger, `${v2}\n${v3}\n`);
    expect(gate(root).detail).not.toContain('missing/invalid: stage-evidence.jsonl');
  });
});
