import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';
import { seedFeatureRecord } from '@/feature-evidence/feature-record.js';
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
  specPipelineStrict: false,
  specPipelineEnabled: false,
  expertsEnabled: false,
  stageIsolationExpected: false,
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
  // Issue #581 — the signed spec source is always required beside specification.json.
  write(root, featureFilePath(dir, 'specMd'), '# Specification\n');
  write(root, featureFilePath(dir, 'review'), '{}');
  write(root, featureFilePath(dir, 'stageEvidence'), '{"row":1}\n');
  write(root, featureFilePath(dir, 'delivery'), '{"branch":"feat/x"}');
  // Issue #581 — evidence.jsonl is always required.
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
    write(root, featureFilePath(DIR, 'plan'), '   '); // present but not valid json
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
    writeAlwaysFiles(root, UNTITLED); // seedFeatureRecord on change-<ULID> → title `change`, issue null
    const gate = bundleCompletenessGate({
      ...base,
      projectRoot: root,
      dirName: UNTITLED,
      mode: 'strict',
    });
    expect(gate!.status).toBe('fail');
    expect(gate!.detail).toContain('no title and no ticket');
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
    stageIsolationExpected: false,
  };

  it('passes with every required file present and no "Skipped (flag off)" note', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR);
    // The spec pipeline files (issue #581, M3).
    write(root, featureFilePath(DIR, 'request'), '# Request\n');
    for (const key of ['clarification', 'experts'] as const) {
      write(root, featureFilePath(DIR, key), '{}');
    }
    // The flag-gated files.
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

describe('optional checks.json (#528)', () => {
  // checks.json is `optional`: never required (absence never fails), and never named in the
  // "flag off" note (it has no flag). The genuinely flag-gated files still surface there under
  // ONLY_ALWAYS — the ALL_ON "no flag-off note" case is covered above.
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
    // Present files are counted, not named; and checks.json must never appear in the skip note.
    // 8 always-required files (evidence.jsonl and spec.md since #581) + the present checks.json.
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

/** Write a frozen spec pair: spec.md with front matter over `body`, and its record. */
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

describe('spec.md signed source (issue #581, FR-15)', () => {
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

  it('fails closed when spec.md is missing from a bundle frozen since #581', () => {
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

  it('accepts a pre-#581 bundle: old spec_file and a specification.md projection, no spec.md', () => {
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
    // Without spec.md the legacy fallback finds no readable record either.
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

describe('spec pipeline files (issue #581, M2/M3/M5)', () => {
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

describe('evidence.jsonl written by this run (issue #581)', () => {
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

// Issue #547 — the strict-adoption content check on specification.json (FR-10.2 / AC-12).
describe('spec pipeline strict adoption gate', () => {
  const STRICT = { ...ONLY_ALWAYS, specPipelineStrict: true };

  it('fails closed under strict when specification.json records no pipeline provenance', () => {
    const root = tempRoot();
    writeAlwaysFiles(root, DIR); // specification.json is '{}' — no provenance
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
    writeAlwaysFiles(root, DIR); // no provenance
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

describe('the isolation evidence stream (issue #573)', () => {
  it('fails a graduated/full change on a subagent-capable host with no isolation evidence', () => {
    // The core #573 scenario: the full pipeline ran, every pillar artifact is present, and
    // the change nonetheless did all six stages in ONE context. Before this it read
    // "Safe to merge"; now it must fail, and name the stream that is missing.
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
    // Issue #581 (AC-14) — named by the rows that are missing, never a retired file.
    expect(gate!.detail).toContain('stage-agent rows in stage-evidence.jsonl');
    expect(gate!.remediation).toContain('stage-agent rows in stage-evidence.jsonl');
    expect(gate!.detail).not.toContain('context-efficiency.jsonl');
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

  it('still accepts a pre-#581 bundle that recorded isolation in context-efficiency.jsonl', () => {
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
    // Fast lane, or a host with no subagent dispatch. Identical bundle, no failure.
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
    // Issue #528 added the `optional` category so a non-required file is not reported as
    // a flag-off skip. Stage isolation is deliberately flagless, so that wording would be
    // an outright lie about why the file is not required for this change.
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
});

// Issue #581 (FR-14, AC-24) — a document or row changed outside its writer fails its envelope
// content_hash, and the gate names the file. A hook cannot see a Bash write into the bundle, so
// this is the backstop on every host.
describe('bundleCompletenessGate content_hash backstop (issue #581, AC-24)', () => {
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
    // A blank line and an unparseable line are the reader's concern, never a hash mismatch.
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
