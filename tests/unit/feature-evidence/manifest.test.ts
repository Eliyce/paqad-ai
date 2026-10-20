import { describe, expect, it } from 'vitest';

import {
  BUNDLE_MANIFEST,
  FAST_LANE_REFREEZE_HINT,
  isBundleFileRequired,
  isSpecFrozenBeforePipeline,
  isSpecFrozenOnFastLane,
  laneRunsSpecPipeline,
  requiredBundleFiles,
  specPipelineApplies,
  specPipelineStrictApplies,
  validateBundleFileContent,
  readSpecAdoption,
  validateSpecificationAdoption,
  type BundleCompletenessConfig,
} from '@/feature-evidence/manifest.js';
import { FEATURE_BUNDLE_FILES } from '@/feature-evidence/paths.js';

const ALL_ON: BundleCompletenessConfig = {
  lane: 'full',
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
  specFrozenBeforePipeline: false,
  stageIsolationExpected: true,
  stageIsolationUnresolved: false,
};

const ALL_OFF: BundleCompletenessConfig = {
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

describe('validateSpecificationAdoption', () => {
  it('reads the pipeline section of a record frozen since the evidence envelope', () => {
    expect(validateSpecificationAdoption(JSON.stringify({ pipeline: { produced: true } })).ok).toBe(
      true,
    );
    expect(
      validateSpecificationAdoption(
        JSON.stringify({ pipeline: { produced: false, manual_reason: 'hotfix' } }),
      ).ok,
    ).toBe(true);
    expect(
      validateSpecificationAdoption(JSON.stringify({ pipeline: { produced: false } })).ok,
    ).toBe(false);
    expect(
      validateSpecificationAdoption(
        JSON.stringify({ pipeline: { produced: false }, provenance: { pipeline_produced: true } }),
      ).ok,
    ).toBe(false);
  });

  it('readSpecAdoption reads both shapes and nothing else', () => {
    expect(readSpecAdoption({ pipeline: { produced: true } })).toEqual({ produced: true });
    expect(
      readSpecAdoption({ provenance: { pipeline_produced: false, manual_reason: 'r' } }),
    ).toEqual({ produced: false, manual_reason: 'r' });
    expect(readSpecAdoption({ pipeline: { produced: false, skipped: 'fast-lane' } })).toEqual({
      produced: false,
      fast_lane: true,
    });
    expect(readSpecAdoption({ pipeline: { produced: false, skipped: 'other' } })).toEqual({
      produced: false,
    });
    expect(readSpecAdoption({ pipeline: null })).toBeNull();
    expect(readSpecAdoption(null)).toBeNull();
    expect(readSpecAdoption('x')).toBeNull();
  });

  it('reads a fast-lane freeze as recorded, not pre-pipeline, and asks for a re-freeze', () => {
    const fast = { pipeline: { produced: false, skipped: 'fast-lane' } };
    expect(isSpecFrozenBeforePipeline(fast)).toBe(false);
    expect(isSpecFrozenOnFastLane(fast)).toBe(true);
    expect(isSpecFrozenOnFastLane({ pipeline: { produced: false } })).toBe(false);
    expect(isSpecFrozenOnFastLane({ spec_file: 'spec.md' })).toBe(false);
    expect(isSpecFrozenOnFastLane(null)).toBe(false);
    const failure = validateSpecificationAdoption(JSON.stringify(fast));
    expect(failure.ok).toBe(false);
    expect(failure.error).toContain(FAST_LANE_REFREEZE_HINT);
    expect(failure.error).toMatch(/lane was raised after a fast-lane freeze/);
  });

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
        'evidence',
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

  it('treats checks.json as optional — never required, never flag-gated', () => {
    const checks = BUNDLE_MANIFEST.find((entry) => entry.key === 'checks');
    expect(checks?.required).toBe('optional');
    expect(isBundleFileRequired(checks!, ALL_ON)).toBe(false);
    expect(isBundleFileRequired(checks!, ALL_OFF)).toBe(false);
    expect(requiredBundleFiles(ALL_ON).map((e) => e.key)).not.toContain('checks');
    expect(requiredBundleFiles(ALL_OFF).map((e) => e.key)).not.toContain('checks');
  });

  it('treats decisions.json as optional', () => {
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

describe('the M0-M5 required file sets', () => {
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

describe('lane-aware spec-pipeline requiredness', () => {
  const PIPELINE_FILES = ['request.md', 'clarification.json', 'experts.json'];
  const pipelineFilesFor = (config: BundleCompletenessConfig): string[] =>
    requiredBundleFiles(config)
      .map((entry) => entry.file)
      .filter((file) => PIPELINE_FILES.includes(file))
      .sort();

  it.each([
    ['graduated', 'graduated'],
    ['full', 'full'],
    ['unresolved (null)', null],
  ] as const)('requires the pipeline files on the %s lane', (_name, lane) => {
    expect(pipelineFilesFor({ ...ALL_ON, lane })).toEqual([...PIPELINE_FILES].sort());
    expect(specPipelineStrictApplies({ ...ALL_ON, lane })).toBe(true);
  });

  it('never requires them on the fast lane, even with every flag on (INV-18)', () => {
    const fast: BundleCompletenessConfig = { ...ALL_ON, lane: 'fast' };
    expect(pipelineFilesFor(fast)).toEqual([]);
    expect(specPipelineApplies(fast)).toBe(false);
    expect(specPipelineStrictApplies(fast)).toBe(false);
    expect(requiredBundleFiles(fast).length).toBe(requiredBundleFiles(ALL_ON).length - 3);
  });

  it('does not ask a spec frozen before the pipeline was on for its files', () => {
    const preSwitch: BundleCompletenessConfig = { ...ALL_ON, specFrozenBeforePipeline: true };
    expect(pipelineFilesFor(preSwitch)).toEqual([]);
    expect(specPipelineApplies(preSwitch)).toBe(false);
    expect(specPipelineStrictApplies(preSwitch)).toBe(false);
  });

  it('keeps the pipeline files off on every lane when the pipeline is off', () => {
    for (const lane of ['fast', 'graduated', 'full', null] as const) {
      expect(pipelineFilesFor({ ...ALL_OFF, lane })).toEqual([]);
      expect(specPipelineStrictApplies({ ...ALL_OFF, lane })).toBe(false);
    }
  });

  it('treats only the fast lane as one that skips the pipeline', () => {
    expect(laneRunsSpecPipeline('fast')).toBe(false);
    expect(laneRunsSpecPipeline('graduated')).toBe(true);
    expect(laneRunsSpecPipeline('full')).toBe(true);
    expect(laneRunsSpecPipeline(null)).toBe(true);
    expect(laneRunsSpecPipeline(undefined)).toBe(true);
  });
});

describe('isSpecFrozenBeforePipeline', () => {
  it('reads a frozen record with no pipeline or provenance section as pre-switch', () => {
    expect(isSpecFrozenBeforePipeline({ spec_file: 'spec.md', spec_hash: 'abc' })).toBe(true);
  });

  it('never reads a record that names how it was produced as pre-switch', () => {
    expect(isSpecFrozenBeforePipeline({ pipeline: { produced: true } })).toBe(false);
    expect(isSpecFrozenBeforePipeline({ pipeline: { produced: false } })).toBe(false);
    expect(
      isSpecFrozenBeforePipeline({ pipeline: { produced: false, manual_reason: 'hotfix' } }),
    ).toBe(false);
    expect(isSpecFrozenBeforePipeline({ provenance: { pipeline_produced: true } })).toBe(false);
  });

  it('reads no record (not frozen yet) as not pre-switch', () => {
    expect(isSpecFrozenBeforePipeline(null)).toBe(false);
    expect(isSpecFrozenBeforePipeline('text')).toBe(false);
  });
});
