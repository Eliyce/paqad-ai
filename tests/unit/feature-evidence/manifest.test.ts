import { describe, expect, it } from 'vitest';

import {
  BUNDLE_MANIFEST,
  isBundleFileRequired,
  requiredBundleFiles,
  validateBundleFileContent,
  validateSpecificationAdoption,
  type BundleCompletenessConfig,
} from '@/feature-evidence/manifest.js';
import { FEATURE_BUNDLE_FILES } from '@/feature-evidence/paths.js';

/** All flags on — every predicate-required file is required. */
const ALL_ON: BundleCompletenessConfig = {
  ruleComplianceOn: true,
  metricsEnabled: true,
  duplicationOn: true,
  featureReport: true,
  ragEnabled: true,
  enterprise: true,
  evidenceLedger: true,
  aiBom: true,
  specPipelineStrict: true,
  specPipelineEnabled: true,
  expertsEnabled: true,
  stageIsolationExpected: true,
};

/** All flags off — only the `always` files are required. */
const ALL_OFF: BundleCompletenessConfig = {
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

// Issue #547 — the strict-adoption content check (FR-10.2 / AC-12).
describe('validateSpecificationAdoption', () => {
  it('passes a pipeline-produced spec', () => {
    expect(
      validateSpecificationAdoption(JSON.stringify({ provenance: { pipeline_produced: true } })).ok,
    ).toBe(true);
  });

  it('passes a spec with a non-empty manual reason', () => {
    expect(
      validateSpecificationAdoption(
        JSON.stringify({ provenance: { pipeline_produced: false, manual_reason: 'hotfix' } }),
      ).ok,
    ).toBe(true);
  });

  it('fails a spec with no provenance, an empty reason, malformed JSON, or absent content', () => {
    expect(validateSpecificationAdoption(JSON.stringify({})).ok).toBe(false);
    expect(
      validateSpecificationAdoption(
        JSON.stringify({ provenance: { pipeline_produced: false, manual_reason: '  ' } }),
      ).ok,
    ).toBe(false);
    const failure = validateSpecificationAdoption('{not json');
    expect(failure.ok).toBe(false);
    expect(failure.error).toMatch(/spec_pipeline_adoption=strict/);
    expect(validateSpecificationAdoption(null).ok).toBe(false);
  });
});

describe('bundle manifest', () => {
  it('covers every FEATURE_BUNDLE_FILES key plus report (guard for future files)', () => {
    const covered = new Set(BUNDLE_MANIFEST.map((entry) => entry.key));
    for (const key of Object.keys(FEATURE_BUNDLE_FILES)) {
      expect(covered.has(key as never)).toBe(true);
    }
    expect(covered.has('report')).toBe(true);
    // No stray keys: every manifest entry maps to a real bundle file or report.html.
    const known = new Set<string>([...Object.keys(FEATURE_BUNDLE_FILES), 'report']);
    for (const entry of BUNDLE_MANIFEST) {
      expect(known.has(entry.key)).toBe(true);
    }
  });

  it('gives every entry a filename, writer and validator', () => {
    for (const entry of BUNDLE_MANIFEST) {
      expect(entry.file.length).toBeGreaterThan(0);
      expect(entry.writer.length).toBeGreaterThan(0);
      expect(['json', 'jsonl>=1', 'nonempty']).toContain(entry.validate);
    }
  });

  it('marks the always-on files required regardless of config', () => {
    const alwaysKeys = BUNDLE_MANIFEST.filter((entry) => entry.required === 'always').map(
      (entry) => entry.key,
    );
    expect(alwaysKeys).toEqual(
      expect.arrayContaining([
        'feature',
        'plan',
        'specification',
        'review',
        'stageEvidence',
        'delivery',
        // Issue #581 — evidence.jsonl is always on, whatever the enterprise toggles.
        'evidence',
        // Issue #581 — the signed spec source.
        'specMd',
      ]),
    );
    for (const entry of BUNDLE_MANIFEST) {
      if (entry.required === 'always') {
        expect(isBundleFileRequired(entry, ALL_OFF)).toBe(true);
      }
    }
  });

  it('requires the flag-gated files only when their flag is on', () => {
    const onKeys = requiredBundleFiles(ALL_ON).map((entry) => entry.key);
    const offKeys = requiredBundleFiles(ALL_OFF).map((entry) => entry.key);
    for (const key of [
      'ruleRun',
      'changeMetrics',
      'duplication',
      'report',
      'rag',
      'receipt',
      'aiBom',
      'request',
      'clarification',
      'experts',
    ]) {
      expect(onKeys).toContain(key);
      expect(offKeys).not.toContain(key);
    }
  });

  it('gates receipt on evidence_ledger and ai-bom on ai_bom (both need enterprise)', () => {
    const ledgerOnly: BundleCompletenessConfig = {
      ...ALL_OFF,
      enterprise: true,
      evidenceLedger: true,
    };
    const keys = requiredBundleFiles(ledgerOnly).map((entry) => entry.key);
    expect(keys).toContain('receipt');
    expect(keys).toContain('evidence');
    expect(keys).not.toContain('aiBom');

    const bomWithoutEnterprise: BundleCompletenessConfig = { ...ALL_OFF, aiBom: true };
    expect(requiredBundleFiles(bomWithoutEnterprise).map((e) => e.key)).not.toContain('aiBom');
  });

  it('treats checks.json as optional — never required, never flag-gated (#528)', () => {
    const checks = BUNDLE_MANIFEST.find((entry) => entry.key === 'checks');
    expect(checks?.required).toBe('optional');
    // Optional means never required, under any config.
    expect(isBundleFileRequired(checks!, ALL_ON)).toBe(false);
    expect(isBundleFileRequired(checks!, ALL_OFF)).toBe(false);
    // And so it is never part of the required work list either way.
    expect(requiredBundleFiles(ALL_ON).map((e) => e.key)).not.toContain('checks');
    expect(requiredBundleFiles(ALL_OFF).map((e) => e.key)).not.toContain('checks');
  });

  it('treats decisions.json as optional (#581)', () => {
    const decisions = BUNDLE_MANIFEST.find((entry) => entry.key === 'decisions');
    expect(decisions?.required).toBe('optional');
    expect(requiredBundleFiles(ALL_ON).map((e) => e.key)).not.toContain('decisions');
  });

  it('flags rag as unrecoverable and nothing else', () => {
    for (const entry of BUNDLE_MANIFEST) {
      expect(Boolean(entry.unrecoverable)).toBe(entry.key === 'rag');
    }
  });
});

describe('validateBundleFileContent', () => {
  it('fails absent content for every validator', () => {
    expect(validateBundleFileContent('json', null)).toBe(false);
    expect(validateBundleFileContent('jsonl>=1', null)).toBe(false);
    expect(validateBundleFileContent('nonempty', null)).toBe(false);
  });

  it('json accepts parseable and rejects garbage', () => {
    expect(validateBundleFileContent('json', '{"a":1}')).toBe(true);
    expect(validateBundleFileContent('json', 'not json')).toBe(false);
  });

  it('jsonl>=1 needs at least one non-blank line', () => {
    expect(validateBundleFileContent('jsonl>=1', '{"row":1}\n')).toBe(true);
    expect(validateBundleFileContent('jsonl>=1', '\n  \n')).toBe(false);
    expect(validateBundleFileContent('jsonl>=1', '')).toBe(false);
  });

  it('nonempty needs any content', () => {
    expect(validateBundleFileContent('nonempty', '<html></html>')).toBe(true);
    expect(validateBundleFileContent('nonempty', '   ')).toBe(false);
  });
});

// Issue #581 — the M0-M5 file-set oracle from the issue. rules-loaded.json and
// visual-evidence.json are in the oracle's lists but are 'optional' here: their dedicated gates
// (rulesLoadedGate, VisualEvidenceGate) enforce them with signals this manifest does not have.
describe('the #581 M0-M5 required file sets', () => {
  const M0: BundleCompletenessConfig = ALL_OFF;
  const M1: BundleCompletenessConfig = {
    ...ALL_OFF,
    ruleComplianceOn: true,
    metricsEnabled: true,
    duplicationOn: true,
    featureReport: true,
  };
  const M2: BundleCompletenessConfig = { ...M1, specPipelineEnabled: true };
  const M3: BundleCompletenessConfig = { ...M2, expertsEnabled: true };
  const M4: BundleCompletenessConfig = {
    ...M3,
    ragEnabled: true,
    enterprise: true,
    evidenceLedger: true,
    aiBom: true,
  };
  const M5: BundleCompletenessConfig = { ...M1, expertsEnabled: true };

  const files = (config: BundleCompletenessConfig): string[] =>
    requiredBundleFiles(config)
      .map((entry) => entry.file)
      .sort();
  const M0_FILES = [
    'feature.json',
    'plan.json',
    'spec.md',
    'specification.json',
    'review.json',
    'stage-evidence.jsonl',
    'delivery.json',
    'evidence.jsonl',
  ];
  const M1_FILES = [
    ...M0_FILES,
    'rule-run.jsonl',
    'duplication.jsonl',
    'change-metrics.jsonl',
    'report.html',
  ];
  const M2_FILES = [...M1_FILES, 'request.md', 'clarification.json'];
  const M3_FILES = [...M2_FILES, 'experts.json'];
  const M4_FILES = [...M3_FILES, 'rag.jsonl', 'receipt.json', 'ai-bom.json'];

  it.each([
    ['M0', M0, M0_FILES],
    ['M1', M1, M1_FILES],
    ['M2', M2, M2_FILES],
    ['M3', M3, M3_FILES],
    ['M4', M4, M4_FILES],
    ['M5', M5, M1_FILES],
  ] as const)('%s requires exactly its listed files', (_name, config, expected) => {
    expect(files(config)).toEqual([...expected].sort());
  });

  it('never names specification.md or context-efficiency.jsonl', () => {
    const all = BUNDLE_MANIFEST.map((entry) => entry.file);
    expect(all).not.toContain('specification.md');
    expect(all).not.toContain('context-efficiency.jsonl');
  });
});
